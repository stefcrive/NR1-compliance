-- Hard reset + reseed for "DNRS standard 2026 - evostudio*" with exactly 10 responses per active sector.
do $$
declare
  v_survey_id uuid;
begin
  select s.id
  into v_survey_id
  from surveys s
  where lower(s.name) like 'dnrs standard 2026 - evostudio%'
  order by s.created_at desc
  limit 1;

  if v_survey_id is null then
    raise notice 'No DNRS evostudio survey found. Skipping reseed.';
    return;
  end if;

  delete from answers a
  using responses r
  where a.response_id = r.id
    and r.survey_id = v_survey_id;

  delete from responses
  where survey_id = v_survey_id;

  with active_sectors as (
    select
      ss.id,
      ss.key,
      ss.name,
      row_number() over (order by ss.name, ss.id) as sector_idx
    from survey_sectors ss
    where ss.survey_id = v_survey_id
      and ss.is_active = true
  ),
  respondents as (
    select
      s.id as sector_id,
      s.key as sector_key,
      s.name as sector_name,
      s.sector_idx,
      gs as employee_idx,
      (
        substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 1, 8)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 9, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 13, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 17, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 21, 12)
      )::uuid as response_id,
      (
        timestamp with time zone '2026-03-06 09:00:00+00'
        + ((s.sector_idx - 1) * interval '18 hours')
        + ((gs - 1) * interval '9 minutes')
      ) as submitted_at
    from active_sectors s
    cross join generate_series(1, 10) as gs
  )
  insert into responses (
    id,
    survey_id,
    submitted_at,
    session_sid,
    ip_hash,
    group_values,
    answers_json,
    sector_id
  )
  select
    r.response_id,
    v_survey_id,
    r.submitted_at,
    (
      substr(md5(concat('sid:', r.response_id::text)), 1, 8)
      || '-'
      || substr(md5(concat('sid:', r.response_id::text)), 9, 4)
      || '-'
      || substr(md5(concat('sid:', r.response_id::text)), 13, 4)
      || '-'
      || substr(md5(concat('sid:', r.response_id::text)), 17, 4)
      || '-'
      || substr(md5(concat('sid:', r.response_id::text)), 21, 12)
    )::uuid,
    null,
    jsonb_build_object(
      'sector', r.sector_name,
      'sector_key', r.sector_key,
      'role', case when (r.employee_idx % 4) = 0 then 'lideranca' else 'analista' end
    ),
    '[]'::jsonb,
    r.sector_id
  from respondents r
  on conflict (id) do update set
    survey_id = excluded.survey_id,
    submitted_at = excluded.submitted_at,
    session_sid = excluded.session_sid,
    ip_hash = excluded.ip_hash,
    group_values = excluded.group_values,
    answers_json = excluded.answers_json,
    sector_id = excluded.sector_id;

  with active_sectors as (
    select
      ss.id,
      ss.key,
      ss.name,
      row_number() over (order by ss.name, ss.id) as sector_idx
    from survey_sectors ss
    where ss.survey_id = v_survey_id
      and ss.is_active = true
  ),
  respondents as (
    select
      s.id as sector_id,
      s.sector_idx,
      gs as employee_idx,
      (
        substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 1, 8)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 9, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 13, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 17, 4)
        || '-'
        || substr(md5(concat(v_survey_id::text, ':', s.id::text, ':', gs::text)), 21, 12)
      )::uuid as response_id
    from active_sectors s
    cross join generate_series(1, 10) as gs
  ),
  topic_baselines (topic_id, base_score) as (
    values
      (1, 2.65::numeric),
      (2, 2.40::numeric),
      (3, 2.85::numeric),
      (4, 2.35::numeric),
      (5, 2.55::numeric),
      (6, 2.30::numeric),
      (7, 2.70::numeric),
      (8, 2.05::numeric),
      (9, 2.20::numeric),
      (10, 3.85::numeric),
      (11, 3.00::numeric),
      (12, 3.30::numeric),
      (13, 3.15::numeric)
  ),
  sector_profiles as (
    select
      s.id as sector_id,
      case
        when (s.sector_idx % 3) = 1 then 0.30::numeric
        when (s.sector_idx % 3) = 2 then 0.15::numeric
        else -0.08::numeric
      end as pressure_shift,
      case
        when (s.sector_idx % 2) = 0 then 0.18::numeric
        else -0.05::numeric
      end as relationship_shift
    from active_sectors s
  ),
  scored_answers as (
    select
      r.response_id,
      q.id as question_id,
      q.scoring_rule,
      round(
        greatest(
          1::numeric,
          least(
            5::numeric,
            coalesce(tb.base_score, 2.75::numeric)
            + coalesce(sp.pressure_shift, 0::numeric)
              * case
                  when q.topic_id in (10, 12, 13) then 1.0
                  when q.topic_id in (1, 7, 11) then 0.55
                  else 0.25
                end
            + coalesce(sp.relationship_shift, 0::numeric)
              * case
                  when q.topic_id in (1, 7, 11) then 1.0
                  when q.topic_id in (4, 5, 6) then 0.45
                  else 0.20
                end
            + case
                when r.employee_idx in (1, 2) then 0.52::numeric
                when r.employee_idx in (3, 4, 5) then 0.24::numeric
                when r.employee_idx in (9, 10) then -0.22::numeric
                else 0.04::numeric
              end
            + (((q.position % 5)::numeric - 2) * 0.05)
            + (
              (
                (mod(abs((('x' || substr(md5(concat(r.response_id::text, '-', q.id::text)), 1, 8))::bit(32)::bigint)), 1000)::numeric / 1000)
                - 0.5
              ) * 0.46
            )
          )
        ),
        4
      )::numeric(8,4) as corrected_value
    from respondents r
    join questions q
      on q.survey_id = v_survey_id
     and q.is_active = true
    left join topic_baselines tb on tb.topic_id = q.topic_id
    left join sector_profiles sp on sp.sector_id = r.sector_id
  )
  insert into answers (response_id, question_id, raw_value, corrected_value)
  select
    sa.response_id,
    sa.question_id,
    case
      when sa.scoring_rule = 'inverted' then round((6 - sa.corrected_value)::numeric, 4)
      else sa.corrected_value
    end as raw_value,
    sa.corrected_value
  from scored_answers sa
  on conflict (response_id, question_id) do update set
    raw_value = excluded.raw_value,
    corrected_value = excluded.corrected_value;

  with response_payload as (
    select
      a.response_id,
      jsonb_agg(
        jsonb_build_object(
          'question_id', a.question_id,
          'value', a.raw_value,
          'corrected_value', a.corrected_value
        )
        order by q.position
      ) as answers_json
    from answers a
    join questions q on q.id = a.question_id
    where q.survey_id = v_survey_id
    group by a.response_id
  )
  update responses r
  set answers_json = rp.answers_json
  from response_payload rp
  where r.id = rp.response_id
    and r.survey_id = v_survey_id;

  update survey_sectors ss
  set
    submission_count = 0,
    last_submitted_at = null,
    updated_at = now()
  where ss.survey_id = v_survey_id;

  update survey_sectors ss
  set
    submission_count = counts.n,
    last_submitted_at = counts.last_submitted_at,
    updated_at = now()
  from (
    select
      r.sector_id,
      count(*)::int as n,
      max(r.submitted_at) as last_submitted_at
    from responses r
    where r.survey_id = v_survey_id
      and r.sector_id is not null
    group by r.sector_id
  ) as counts
  where ss.id = counts.sector_id;

  if exists (
    select 1
    from pg_proc
    where proname = 'refresh_survey_sector_risk_factor_timeseries'
  ) then
    perform refresh_survey_sector_risk_factor_timeseries(v_survey_id);
  end if;
end $$;
