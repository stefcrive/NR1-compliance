-- Refresh synthetic DRPS Q2 dataset with more realistic variability for report/matrix tests.
with respondent_base as (
  select
    r.id as response_id,
    r.submitted_at,
    coalesce(
      nullif(trim(ss.key), ''),
      lower(regexp_replace(coalesce(r.group_values ->> 'sector_key', r.group_values ->> 'sector', 'sem_setor'), '[^a-z0-9]+', '', 'g'))
    ) as sector_key,
    row_number() over (order by r.submitted_at, r.id) as employee_idx
  from responses r
  left join survey_sectors ss on ss.id = r.sector_id
  where r.survey_id = '11111111-1111-1111-1111-111111111020'
),
respondents as (
  select
    rb.response_id,
    rb.submitted_at,
    rb.sector_key,
    rb.employee_idx,
    case
      when (rb.employee_idx % 7) in (0, 1) then 'critical'
      when (rb.employee_idx % 7) in (2, 3) then 'pressured'
      when (rb.employee_idx % 7) in (4, 5) then 'stable'
      else 'resilient'
    end as persona
  from respondent_base rb
),
topic_baselines (topic_id, base_score) as (
  values
    (1, 2.70::numeric),
    (2, 2.45::numeric),
    (3, 2.85::numeric),
    (4, 2.30::numeric),
    (5, 2.60::numeric),
    (6, 2.35::numeric),
    (7, 2.75::numeric),
    (8, 1.90::numeric),
    (9, 2.05::numeric),
    (10, 3.90::numeric),
    (11, 3.05::numeric),
    (12, 3.35::numeric),
    (13, 3.20::numeric)
),
sector_topic_adjustments (sector_key, topic_id, adjustment) as (
  values
    ('tecnologia', 3, 0.20::numeric),
    ('tecnologia', 8, -0.15::numeric),
    ('tecnologia', 10, 0.45::numeric),
    ('tecnologia', 12, 0.30::numeric),
    ('tecnologia', 13, 0.40::numeric),
    ('financeiro', 1, 0.32::numeric),
    ('financeiro', 6, -0.12::numeric),
    ('financeiro', 7, 0.35::numeric),
    ('financeiro', 10, 0.18::numeric),
    ('financeiro', 11, 0.25::numeric),
    ('financeiro', 12, 0.22::numeric),
    ('comercial', 4, -0.10::numeric),
    ('comercial', 5, 0.35::numeric),
    ('comercial', 10, 0.20::numeric),
    ('comercial', 11, 0.40::numeric),
    ('comercial', 12, 0.28::numeric)
),
persona_adjustments (persona, adjustment) as (
  values
    ('resilient', -0.34::numeric),
    ('stable', -0.06::numeric),
    ('pressured', 0.36::numeric),
    ('critical', 0.80::numeric)
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
          tb.base_score
          + coalesce(sta.adjustment, 0::numeric)
          + pa.adjustment
          + (((q.position % 6)::numeric - 2.5) * 0.04)
          + ((extract(isodow from r.submitted_at)::numeric - 4) * 0.03)
          + (
            ((mod(abs((('x' || substr(md5(concat(r.response_id::text, '-emp')), 1, 8))::bit(32)::bigint)), 1000)::numeric / 1000) - 0.5)
            * 0.44
          )
          + (
            ((mod(abs((('x' || substr(md5(concat(r.response_id::text, '-q-', q.id::text)), 1, 8))::bit(32)::bigint)), 1000)::numeric / 1000) - 0.5)
            * 0.56
          )
        )
      ),
      4
    )::numeric(8,4) as corrected_value
  from respondents r
  join questions q
    on q.survey_id = '11111111-1111-1111-1111-111111111020'
   and q.is_active = true
  join topic_baselines tb on tb.topic_id = q.topic_id
  join persona_adjustments pa on pa.persona = r.persona
  left join sector_topic_adjustments sta
    on sta.sector_key = r.sector_key
   and sta.topic_id = q.topic_id
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
      jsonb_build_object('question_id', a.question_id, 'value', a.raw_value)
      order by q.position
    ) as answers_json
  from answers a
  join questions q on q.id = a.question_id
  where q.survey_id = '11111111-1111-1111-1111-111111111020'
  group by a.response_id
)
update responses r
set answers_json = rp.answers_json
from response_payload rp
where r.id = rp.response_id
  and r.survey_id = '11111111-1111-1111-1111-111111111020';

update survey_sectors ss
set
  submission_count = counts.n,
  last_submitted_at = counts.last_submitted_at,
  updated_at = now()
from (
  select
    sector_id,
    count(*)::int as n,
    max(submitted_at) as last_submitted_at
  from responses
  where survey_id = '11111111-1111-1111-1111-111111111020'
    and sector_id is not null
  group by sector_id
) as counts
where ss.id = counts.sector_id;

update drps_assessments
set
  reference_period = '2026-Q2',
  part1_answers = '[
    {"key":"freq_regularidade","label":"Regularidade","score":4},
    {"key":"freq_duracao","label":"Duracao","score":4},
    {"key":"freq_impactados","label":"Impactados","score":4},
    {"key":"hist_registros","label":"Registros","score":4},
    {"key":"hist_gravidade","label":"Gravidade","score":4},
    {"key":"hist_causas","label":"Causas","score":3},
    {"key":"rec_medidas","label":"Medidas preventivas","score":3},
    {"key":"rec_revisao","label":"Revisao","score":2},
    {"key":"rec_conhecimento","label":"Conhecimento","score":3},
    {"key":"rec_recursos","label":"Recursos","score":2}
  ]'::jsonb,
  part1_dimension_scores = '{"frequency":4.00,"history":3.67,"resources":2.67,"resourcesRisk":4.10}'::jsonb,
  part1_probability_score = 3.88,
  part1_probability_class = 'high',
  critical_topics = '[10,12,13,11]'::jsonb,
  recommended_programs = '[
    "Programa de gestao do estresse e prevencao ao burnout",
    "Programa de prevencao e manejo da ansiedade",
    "Programa de saude mental e clima organizacional",
    "Programa de melhoria da comunicacao entre liderancas e equipes",
    "Programa de apoio psicologico"
  ]'::jsonb,
  governance_actions = '[
    "Rito quinzenal de monitoramento por setor",
    "Plano de ajuste de carga para squads e financeiro",
    "Reaplicacao do DRPS em 90 dias"
  ]'::jsonb,
  notes = 'Dataset DNRS 2026 EvoStudio: risco alto em sobrecarga, comunicacao e isolamento no recorte setorial.',
  created_at = '2026-03-08T14:30:00Z'::timestamptz
where id = '88000000-0000-0000-0000-000000000001';

update client_reports
set
  report_title = 'DNRS Standard 2026 - EvoStudio | DRPS Results Report (TechCorp Q2)',
  summary = '{
    "source":"synthetic-dnrs-2026-evostudio",
    "employees_assessed":20,
    "priority_topics":[10,12,13,11],
    "note":"Dataset renovado com variabilidade setorial realista para testes do dashboard"
  }'::jsonb,
  created_at = '2026-03-08T15:00:00Z'::timestamptz
where id = '99000000-0000-0000-0000-000000000001';

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'refresh_survey_sector_risk_factor_timeseries'
  ) then
    perform refresh_survey_sector_risk_factor_timeseries('11111111-1111-1111-1111-111111111020'::uuid);
  end if;
end $$;
