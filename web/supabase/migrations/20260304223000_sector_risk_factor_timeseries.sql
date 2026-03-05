create table if not exists survey_sector_risk_factor_timeseries (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  client_id uuid references clients(client_id) on delete cascade,
  sector_id uuid references survey_sectors(id) on delete set null,
  sector_name text not null,
  topic_id smallint not null references topics(id) on delete restrict,
  period_start date not null,
  response_count int not null check (response_count > 0),
  mean_exposure numeric(8,4) not null check (mean_exposure between 1 and 5),
  std_dev_exposure numeric(8,4) not null check (std_dev_exposure >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, sector_name, topic_id, period_start)
);

create index if not exists survey_sector_risk_factor_timeseries_survey_period_idx
  on survey_sector_risk_factor_timeseries (survey_id, period_start);

create index if not exists survey_sector_risk_factor_timeseries_sector_topic_idx
  on survey_sector_risk_factor_timeseries (survey_id, sector_name, topic_id, period_start);

create or replace function refresh_survey_sector_risk_factor_timeseries(p_survey_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_inserted int := 0;
begin
  select s.client_id
    into v_client_id
  from surveys s
  where s.id = p_survey_id;

  if not found then
    return 0;
  end if;

  delete from survey_sector_risk_factor_timeseries
  where survey_id = p_survey_id;

  with response_topic_scores as (
    select
      r.id as response_id,
      r.survey_id,
      r.sector_id,
      coalesce(ss.name, nullif(trim(r.group_values ->> 'sector'), ''), 'Sem setor') as sector_name,
      q.topic_id,
      date_trunc('month', r.submitted_at)::date as period_start,
      avg(a.corrected_value)::numeric(10,4) as response_topic_score
    from responses r
    join answers a on a.response_id = r.id
    join questions q
      on q.id = a.question_id
     and q.survey_id = r.survey_id
    left join survey_sectors ss on ss.id = r.sector_id
    where r.survey_id = p_survey_id
    group by
      r.id,
      r.survey_id,
      r.sector_id,
      coalesce(ss.name, nullif(trim(r.group_values ->> 'sector'), ''), 'Sem setor'),
      q.topic_id,
      date_trunc('month', r.submitted_at)::date
  ),
  aggregated as (
    select
      p_survey_id as survey_id,
      v_client_id as client_id,
      rts.sector_id,
      rts.sector_name,
      rts.topic_id,
      rts.period_start,
      count(*)::int as response_count,
      round(avg(rts.response_topic_score)::numeric, 4)::numeric(8,4) as mean_exposure,
      round(coalesce(stddev_pop(rts.response_topic_score), 0)::numeric, 4)::numeric(8,4) as std_dev_exposure
    from response_topic_scores rts
    group by
      rts.sector_id,
      rts.sector_name,
      rts.topic_id,
      rts.period_start
  )
  insert into survey_sector_risk_factor_timeseries (
    survey_id,
    client_id,
    sector_id,
    sector_name,
    topic_id,
    period_start,
    response_count,
    mean_exposure,
    std_dev_exposure
  )
  select
    a.survey_id,
    a.client_id,
    a.sector_id,
    a.sector_name,
    a.topic_id,
    a.period_start,
    a.response_count,
    a.mean_exposure,
    a.std_dev_exposure
  from aggregated a
  on conflict (survey_id, sector_name, topic_id, period_start)
  do update set
    client_id = excluded.client_id,
    sector_id = excluded.sector_id,
    response_count = excluded.response_count,
    mean_exposure = excluded.mean_exposure,
    std_dev_exposure = excluded.std_dev_exposure,
    updated_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

do $$
declare
  survey_row record;
begin
  for survey_row in
    select id
    from surveys
  loop
    perform refresh_survey_sector_risk_factor_timeseries(survey_row.id);
  end loop;
end
$$;
