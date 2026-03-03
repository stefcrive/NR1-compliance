-- Backfill legacy DRPS campaigns into editable survey questionnaire records.

-- Older environments may have surveys without client linkage.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'surveys'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'clients'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'surveys'
      and column_name = 'client_id'
  ) then
    alter table surveys
      add column client_id uuid references clients(client_id) on delete set null;
  end if;
end
$$;

with defaults as (
  select
    coalesce((select likert_min from surveys order by created_at asc limit 1), 1)::smallint as likert_min,
    coalesce((select likert_max from surveys order by created_at asc limit 1), 5)::smallint as likert_max,
    coalesce((select k_anonymity_min from surveys order by created_at asc limit 1), 5)::smallint as k_anonymity_min,
    coalesce((select session_ttl_minutes from surveys order by created_at asc limit 1), 30)::smallint as session_ttl_minutes,
    coalesce((select turnstile_site_key from surveys order by created_at asc limit 1), '1x00000000000000000000AA') as turnstile_site_key,
    coalesce((select turnstile_expected_hostname from surveys order by created_at asc limit 1), 'localhost') as turnstile_expected_hostname
),
legacy_campaigns as (
  select
    dc.campaign_id as id,
    dc.campaign_name as name,
    case
      when dc.status = 'Active' then 'live'
      when dc.status = 'Completed' then 'closed'
      else 'draft'
    end::survey_status as status,
    dc.start_date::timestamptz as starts_at,
    dc.end_date::timestamptz as closes_at,
    dc.client_id,
    concat(
      'legacy-',
      coalesce(
        nullif(trim(both '-' from regexp_replace(lower(dc.unique_link_token), '[^a-z0-9]+', '-', 'g')), ''),
        nullif(trim(both '-' from regexp_replace(lower(dc.campaign_name), '[^a-z0-9]+', '-', 'g')), ''),
        'drps'
      ),
      '-',
      replace(substr(dc.campaign_id::text, 1, 8), '-', '')
    ) as public_slug
  from drps_campaigns dc
  where not exists (
    select 1
    from surveys s
    where s.id = dc.campaign_id
  )
)
insert into surveys (
  id,
  name,
  public_slug,
  status,
  likert_min,
  likert_max,
  k_anonymity_min,
  session_ttl_minutes,
  turnstile_site_key,
  turnstile_expected_hostname,
  starts_at,
  closes_at,
  client_id,
  created_at,
  updated_at
)
select
  lc.id,
  lc.name,
  lc.public_slug,
  lc.status,
  d.likert_min,
  d.likert_max,
  d.k_anonymity_min,
  d.session_ttl_minutes,
  d.turnstile_site_key,
  d.turnstile_expected_hostname,
  lc.starts_at,
  lc.closes_at,
  lc.client_id,
  coalesce(lc.starts_at, now()),
  now()
from legacy_campaigns lc
cross join defaults d
on conflict (id) do update
set
  name = excluded.name,
  status = excluded.status,
  starts_at = coalesce(surveys.starts_at, excluded.starts_at),
  closes_at = coalesce(surveys.closes_at, excluded.closes_at),
  client_id = coalesce(surveys.client_id, excluded.client_id),
  updated_at = now();

with template_survey as (
  select q.survey_id
  from questions q
  where q.is_active = true
  group by q.survey_id
  order by count(*) desc, q.survey_id
  limit 1
),
template_questions as (
  select
    q.topic_id,
    q.question_code,
    q.position,
    q.prompt,
    q.dimension,
    q.scoring_rule,
    q.is_active,
    q.is_required,
    q.source_excel_col
  from questions q
  join template_survey ts on ts.survey_id = q.survey_id
  order by q.position asc
),
target_surveys as (
  select s.id as survey_id
  from surveys s
  join drps_campaigns dc on dc.campaign_id = s.id
  where not exists (
    select 1
    from questions q
    where q.survey_id = s.id
  )
)
insert into questions (
  survey_id,
  topic_id,
  question_code,
  position,
  prompt,
  dimension,
  scoring_rule,
  is_active,
  is_required,
  source_excel_col
)
select
  ts.survey_id,
  tq.topic_id,
  tq.question_code,
  tq.position,
  tq.prompt,
  tq.dimension,
  tq.scoring_rule,
  tq.is_active,
  tq.is_required,
  tq.source_excel_col
from target_surveys ts
cross join template_questions tq
on conflict (survey_id, question_code) do update
set
  topic_id = excluded.topic_id,
  position = excluded.position,
  prompt = excluded.prompt,
  dimension = excluded.dimension,
  scoring_rule = excluded.scoring_rule,
  is_active = excluded.is_active,
  is_required = excluded.is_required,
  source_excel_col = excluded.source_excel_col;

with template_dimension_survey as (
  select d.survey_id
  from survey_group_dimensions d
  group by d.survey_id
  order by count(*) desc, d.survey_id
  limit 1
),
target_surveys as (
  select s.id as survey_id
  from surveys s
  join drps_campaigns dc on dc.campaign_id = s.id
  where not exists (
    select 1
    from survey_group_dimensions d
    where d.survey_id = s.id
  )
),
template_dimensions as (
  select
    d.key,
    d.label,
    d.is_required
  from survey_group_dimensions d
  join template_dimension_survey tds on tds.survey_id = d.survey_id
),
upserted_dimensions as (
  insert into survey_group_dimensions (
    survey_id,
    key,
    label,
    is_required
  )
  select
    ts.survey_id,
    td.key,
    td.label,
    td.is_required
  from target_surveys ts
  cross join template_dimensions td
  on conflict (survey_id, key) do update
  set
    label = excluded.label,
    is_required = excluded.is_required
  returning id, survey_id, key
),
template_options as (
  select
    d.key,
    o.value,
    o.label,
    o.sort_order
  from survey_group_dimensions d
  join survey_group_options o on o.dimension_id = d.id
  join template_dimension_survey tds on tds.survey_id = d.survey_id
)
insert into survey_group_options (
  dimension_id,
  value,
  label,
  sort_order
)
select
  ud.id,
  topt.value,
  topt.label,
  topt.sort_order
from upserted_dimensions ud
join template_options topt on topt.key = ud.key
on conflict (dimension_id, value) do update
set
  label = excluded.label,
  sort_order = excluded.sort_order;