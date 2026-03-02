create table if not exists drps_assessments (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  sector text not null,
  psychologist_name text not null,
  psychologist_crp text,
  company_name text not null,
  company_cnpj text,
  reference_period text not null,
  part1_answers jsonb not null default '[]'::jsonb,
  part1_dimension_scores jsonb not null default '{}'::jsonb,
  part1_probability_score numeric(8,4) not null,
  part1_probability_class text not null,
  critical_topics jsonb not null default '[]'::jsonb,
  recommended_programs jsonb not null default '[]'::jsonb,
  governance_actions jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists drps_assessments_survey_created_idx
  on drps_assessments (survey_id, created_at desc);

create index if not exists drps_assessments_sector_idx
  on drps_assessments (survey_id, sector);

create or replace function get_campaign_stats()
returns table (
  id uuid,
  name text,
  public_slug text,
  status survey_status,
  starts_at timestamptz,
  closes_at timestamptz,
  k_anonymity_min smallint,
  question_count int,
  response_count int,
  latest_response_at timestamptz,
  created_at timestamptz
)
language sql
stable
as $$
with q as (
  select survey_id, count(*)::int as question_count
  from questions
  where is_active = true
  group by survey_id
),
r as (
  select survey_id, count(*)::int as response_count, max(submitted_at) as latest_response_at
  from responses
  group by survey_id
)
select
  s.id,
  s.name,
  s.public_slug,
  s.status,
  s.starts_at,
  s.closes_at,
  s.k_anonymity_min,
  coalesce(q.question_count, 0) as question_count,
  coalesce(r.response_count, 0) as response_count,
  r.latest_response_at,
  s.created_at
from surveys s
left join q on q.survey_id = s.id
left join r on r.survey_id = s.id
order by s.created_at desc;
$$;

create or replace function get_response_timeseries(
  p_survey_id uuid,
  p_days int default 30
)
returns table (
  day date,
  response_count int
)
language sql
stable
as $$
with days as (
  select generate_series(
    current_date - make_interval(days => greatest(p_days, 1) - 1),
    current_date,
    interval '1 day'
  )::date as day
),
r as (
  select date_trunc('day', submitted_at)::date as day, count(*)::int as response_count
  from responses
  where survey_id = p_survey_id
    and submitted_at >= current_date - make_interval(days => greatest(p_days, 1))
  group by 1
)
select d.day, coalesce(r.response_count, 0)::int as response_count
from days d
left join r on r.day = d.day
order by d.day asc;
$$;
