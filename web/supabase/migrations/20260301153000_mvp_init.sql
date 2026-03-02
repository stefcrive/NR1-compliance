create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'survey_status') then
    create type survey_status as enum ('draft', 'live', 'closed', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'question_dimension') then
    create type question_dimension as enum ('severity', 'probability');
  end if;
  if not exists (select 1 from pg_type where typname = 'scoring_rule') then
    create type scoring_rule as enum ('direct', 'inverted');
  end if;
end
$$;

create table if not exists surveys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  public_slug text not null unique,
  status survey_status not null default 'draft',
  likert_min smallint not null default 1,
  likert_max smallint not null default 5,
  k_anonymity_min smallint not null default 5 check (k_anonymity_min >= 3),
  session_ttl_minutes smallint not null default 30 check (session_ttl_minutes between 15 and 60),
  turnstile_site_key text not null,
  turnstile_expected_hostname text not null,
  starts_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists topics (
  id smallint primary key check (id between 1 and 13),
  code text not null unique,
  name text not null
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  topic_id smallint not null references topics(id),
  question_code text not null,
  position int not null,
  prompt text not null,
  dimension question_dimension not null,
  scoring_rule scoring_rule not null,
  is_active boolean not null default true,
  is_required boolean not null default true,
  source_excel_col text,
  created_at timestamptz not null default now(),
  unique (survey_id, question_code),
  unique (survey_id, position)
);

create table if not exists survey_group_dimensions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  key text not null,
  label text not null,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (survey_id, key)
);

create table if not exists survey_group_options (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references survey_group_dimensions(id) on delete cascade,
  value text not null,
  label text not null,
  sort_order int not null default 0,
  unique (dimension_id, value)
);

create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  session_sid uuid,
  ip_hash text check (ip_hash is null or length(ip_hash) = 64),
  group_values jsonb not null default '{}'::jsonb,
  answers_json jsonb not null,
  check (jsonb_typeof(group_values) = 'object'),
  check (jsonb_typeof(answers_json) = 'array')
);

create table if not exists answers (
  response_id uuid not null references responses(id) on delete cascade,
  question_id uuid not null references questions(id) on delete restrict,
  raw_value numeric(8,4) not null,
  corrected_value numeric(8,4) not null,
  created_at timestamptz not null default now(),
  primary key (response_id, question_id)
);

create table if not exists rate_limit_buckets (
  survey_id uuid not null references surveys(id) on delete cascade,
  ip_hash text not null check (length(ip_hash) = 64),
  window_start timestamptz not null,
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (survey_id, ip_hash, window_start)
);

create index if not exists surveys_slug_status_idx on surveys (public_slug, status);
create index if not exists questions_survey_position_idx on questions (survey_id, position);
create index if not exists questions_survey_topic_dim_idx on questions (survey_id, topic_id, dimension);
create index if not exists responses_survey_submitted_idx on responses (survey_id, submitted_at desc);
create index if not exists responses_survey_sid_idx on responses (survey_id, session_sid);
create index if not exists responses_group_values_gin_idx on responses using gin (group_values);
create index if not exists answers_question_idx on answers (question_id);
create index if not exists rate_limit_lookup_idx on rate_limit_buckets (survey_id, ip_hash, window_start desc);

create or replace function check_rate_limit(
  p_survey_id uuid,
  p_ip_hash text,
  p_now timestamptz default now(),
  p_burst_limit int default 5,
  p_hour_limit int default 30
)
returns table (
  allowed boolean,
  minute_hits int,
  hour_hits int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute_bucket timestamptz := date_trunc('minute', p_now);
begin
  insert into rate_limit_buckets (survey_id, ip_hash, window_start, hit_count)
  values (p_survey_id, p_ip_hash, v_minute_bucket, 1)
  on conflict (survey_id, ip_hash, window_start)
  do update set hit_count = rate_limit_buckets.hit_count + 1;

  select rlb.hit_count
    into minute_hits
  from rate_limit_buckets rlb
  where rlb.survey_id = p_survey_id
    and rlb.ip_hash = p_ip_hash
    and rlb.window_start = v_minute_bucket;

  select coalesce(sum(rlb.hit_count), 0)::int
    into hour_hits
  from rate_limit_buckets rlb
  where rlb.survey_id = p_survey_id
    and rlb.ip_hash = p_ip_hash
    and rlb.window_start >= (p_now - interval '1 hour');

  allowed := minute_hits <= p_burst_limit and hour_hits <= p_hour_limit;
  return next;
end;
$$;

create or replace function get_topic_aggregates(
  p_survey_id uuid,
  p_group_key text default null,
  p_group_value text default null
)
returns table (
  topic_id smallint,
  n_responses int,
  mean_severity numeric(10,4),
  mean_probability numeric(10,4)
)
language sql
stable
as $$
with filtered_responses as (
  select r.id
  from responses r
  where r.survey_id = p_survey_id
    and (
      p_group_key is null
      or (
        p_group_value is not null
        and r.group_values ? p_group_key
        and r.group_values ->> p_group_key = p_group_value
      )
    )
),
response_count as (
  select count(*)::int as n
  from filtered_responses
),
topic_dim as (
  select
    q.topic_id,
    q.dimension,
    avg(a.corrected_value)::numeric(10,4) as mean_value
  from answers a
  join questions q on q.id = a.question_id
  where q.survey_id = p_survey_id
    and a.response_id in (select id from filtered_responses)
  group by q.topic_id, q.dimension
),
topics_in_survey as (
  select distinct q.topic_id
  from questions q
  where q.survey_id = p_survey_id
)
select
  tis.topic_id,
  rc.n as n_responses,
  max(case when td.dimension = 'severity' then td.mean_value end) as mean_severity,
  max(case when td.dimension = 'probability' then td.mean_value end) as mean_probability
from topics_in_survey tis
cross join response_count rc
left join topic_dim td on td.topic_id = tis.topic_id
group by tis.topic_id, rc.n
order by tis.topic_id;
$$;

create or replace function get_group_counts(
  p_survey_id uuid,
  p_group_key text
)
returns table (
  group_value text,
  n_responses int
)
language sql
stable
as $$
select
  r.group_values ->> p_group_key as group_value,
  count(*)::int as n_responses
from responses r
where r.survey_id = p_survey_id
  and coalesce(r.group_values ->> p_group_key, '') <> ''
group by r.group_values ->> p_group_key
order by n_responses desc, group_value asc;
$$;
