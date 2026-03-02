-- Seed extra live campaigns with multi-company DRPS mock data.
-- This supports report and dashboard validation across multiple tenants.

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
  turnstile_expected_hostname
)
values
  (
    '11111111-1111-1111-1111-111111111002',
    'TechCorp Brasil - DRPS 2026 Q1',
    'techcorp-brasil-2026-q1',
    'live',
    1,
    5,
    3,
    30,
    '1x00000000000000000000AA',
    'localhost'
  ),
  (
    '11111111-1111-1111-1111-111111111003',
    'Industria Alfa - DRPS 2026 Q1',
    'industria-alfa-2026-q1',
    'live',
    1,
    5,
    3,
    30,
    '1x00000000000000000000AA',
    'localhost'
  ),
  (
    '11111111-1111-1111-1111-111111111004',
    'Varejo Horizonte - DRPS 2026 Q1',
    'varejo-horizonte-2026-q1',
    'live',
    1,
    5,
    3,
    30,
    '1x00000000000000000000AA',
    'localhost'
  )
on conflict (id) do update set
  name = excluded.name,
  public_slug = excluded.public_slug,
  status = excluded.status,
  likert_min = excluded.likert_min,
  likert_max = excluded.likert_max,
  k_anonymity_min = excluded.k_anonymity_min,
  session_ttl_minutes = excluded.session_ttl_minutes,
  turnstile_site_key = excluded.turnstile_site_key,
  turnstile_expected_hostname = excluded.turnstile_expected_hostname,
  updated_at = now();

with target_surveys as (
  select unnest(
    array[
      '11111111-1111-1111-1111-111111111002'::uuid,
      '11111111-1111-1111-1111-111111111003'::uuid,
      '11111111-1111-1111-1111-111111111004'::uuid
    ]
  ) as survey_id
)
insert into survey_group_dimensions (survey_id, key, label, is_required)
select
  ts.survey_id,
  d.key,
  d.label,
  d.is_required
from target_surveys ts
cross join survey_group_dimensions d
where d.survey_id = '11111111-1111-1111-1111-111111111001'
on conflict (survey_id, key) do update set
  label = excluded.label,
  is_required = excluded.is_required;

with source_options as (
  select
    d.key,
    o.value,
    o.label,
    o.sort_order
  from survey_group_dimensions d
  join survey_group_options o on o.dimension_id = d.id
  where d.survey_id = '11111111-1111-1111-1111-111111111001'
),
target_dimensions as (
  select d.id, d.key
  from survey_group_dimensions d
  where d.survey_id in (
    '11111111-1111-1111-1111-111111111002',
    '11111111-1111-1111-1111-111111111003',
    '11111111-1111-1111-1111-111111111004'
  )
)
insert into survey_group_options (dimension_id, value, label, sort_order)
select
  td.id,
  so.value,
  so.label,
  so.sort_order
from target_dimensions td
join source_options so on so.key = td.key
on conflict (dimension_id, value) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

with target_surveys as (
  select unnest(
    array[
      '11111111-1111-1111-1111-111111111002'::uuid,
      '11111111-1111-1111-1111-111111111003'::uuid,
      '11111111-1111-1111-1111-111111111004'::uuid
    ]
  ) as survey_id
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
  q.topic_id,
  q.question_code,
  q.position,
  q.prompt,
  q.dimension,
  q.scoring_rule,
  q.is_active,
  q.is_required,
  q.source_excel_col
from target_surveys ts
cross join questions q
where q.survey_id = '11111111-1111-1111-1111-111111111001'
on conflict (survey_id, question_code) do update set
  topic_id = excluded.topic_id,
  position = excluded.position,
  prompt = excluded.prompt,
  dimension = excluded.dimension,
  scoring_rule = excluded.scoring_rule,
  is_active = excluded.is_active,
  is_required = excluded.is_required,
  source_excel_col = excluded.source_excel_col;

with response_seed (id, survey_id, submitted_at, sector, response_offset) as (
  values
    ('22222222-2222-2222-2222-222222220001'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-02T10:00:00Z'::timestamptz, 'Tecnologia', 0.25::numeric),
    ('22222222-2222-2222-2222-222222220002'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-06T10:00:00Z'::timestamptz, 'Tecnologia', 0.18::numeric),
    ('22222222-2222-2222-2222-222222220003'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-11T10:00:00Z'::timestamptz, 'Tecnologia', 0.10::numeric),
    ('22222222-2222-2222-2222-222222220004'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-04T10:00:00Z'::timestamptz, 'Financeiro', 0.32::numeric),
    ('22222222-2222-2222-2222-222222220005'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-09T10:00:00Z'::timestamptz, 'Financeiro', 0.22::numeric),
    ('22222222-2222-2222-2222-222222220006'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-14T10:00:00Z'::timestamptz, 'Financeiro', 0.14::numeric),
    ('33333333-3333-3333-3333-333333330001'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-03T11:00:00Z'::timestamptz, 'Operacoes', 0.30::numeric),
    ('33333333-3333-3333-3333-333333330002'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-08T11:00:00Z'::timestamptz, 'Operacoes', 0.24::numeric),
    ('33333333-3333-3333-3333-333333330003'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-13T11:00:00Z'::timestamptz, 'Operacoes', 0.17::numeric),
    ('33333333-3333-3333-3333-333333330004'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-05T11:00:00Z'::timestamptz, 'Manutencao', 0.28::numeric),
    ('33333333-3333-3333-3333-333333330005'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-10T11:00:00Z'::timestamptz, 'Manutencao', 0.20::numeric),
    ('33333333-3333-3333-3333-333333330006'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-15T11:00:00Z'::timestamptz, 'Manutencao', 0.16::numeric),
    ('44444444-4444-4444-4444-444444440001'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-01T12:00:00Z'::timestamptz, 'Comercial', 0.27::numeric),
    ('44444444-4444-4444-4444-444444440002'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-07T12:00:00Z'::timestamptz, 'Comercial', 0.20::numeric),
    ('44444444-4444-4444-4444-444444440003'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-12T12:00:00Z'::timestamptz, 'Comercial', 0.15::numeric),
    ('44444444-4444-4444-4444-444444440004'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-04T12:00:00Z'::timestamptz, 'Atendimento', 0.29::numeric),
    ('44444444-4444-4444-4444-444444440005'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-09T12:00:00Z'::timestamptz, 'Atendimento', 0.23::numeric),
    ('44444444-4444-4444-4444-444444440006'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-16T12:00:00Z'::timestamptz, 'Atendimento', 0.17::numeric)
)
insert into responses (id, survey_id, submitted_at, session_sid, ip_hash, group_values, answers_json)
select
  rs.id,
  rs.survey_id,
  rs.submitted_at,
  null,
  null,
  jsonb_build_object('sector', rs.sector),
  '[]'::jsonb
from response_seed rs
on conflict (id) do update set
  survey_id = excluded.survey_id,
  submitted_at = excluded.submitted_at,
  group_values = excluded.group_values,
  answers_json = excluded.answers_json;

with response_seed (id, survey_id, submitted_at, sector, response_offset) as (
  values
    ('22222222-2222-2222-2222-222222220001'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-02T10:00:00Z'::timestamptz, 'Tecnologia', 0.25::numeric),
    ('22222222-2222-2222-2222-222222220002'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-06T10:00:00Z'::timestamptz, 'Tecnologia', 0.18::numeric),
    ('22222222-2222-2222-2222-222222220003'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-11T10:00:00Z'::timestamptz, 'Tecnologia', 0.10::numeric),
    ('22222222-2222-2222-2222-222222220004'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-04T10:00:00Z'::timestamptz, 'Financeiro', 0.32::numeric),
    ('22222222-2222-2222-2222-222222220005'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-09T10:00:00Z'::timestamptz, 'Financeiro', 0.22::numeric),
    ('22222222-2222-2222-2222-222222220006'::uuid, '11111111-1111-1111-1111-111111111002'::uuid, '2026-02-14T10:00:00Z'::timestamptz, 'Financeiro', 0.14::numeric),
    ('33333333-3333-3333-3333-333333330001'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-03T11:00:00Z'::timestamptz, 'Operacoes', 0.30::numeric),
    ('33333333-3333-3333-3333-333333330002'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-08T11:00:00Z'::timestamptz, 'Operacoes', 0.24::numeric),
    ('33333333-3333-3333-3333-333333330003'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-13T11:00:00Z'::timestamptz, 'Operacoes', 0.17::numeric),
    ('33333333-3333-3333-3333-333333330004'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-05T11:00:00Z'::timestamptz, 'Manutencao', 0.28::numeric),
    ('33333333-3333-3333-3333-333333330005'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-10T11:00:00Z'::timestamptz, 'Manutencao', 0.20::numeric),
    ('33333333-3333-3333-3333-333333330006'::uuid, '11111111-1111-1111-1111-111111111003'::uuid, '2026-02-15T11:00:00Z'::timestamptz, 'Manutencao', 0.16::numeric),
    ('44444444-4444-4444-4444-444444440001'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-01T12:00:00Z'::timestamptz, 'Comercial', 0.27::numeric),
    ('44444444-4444-4444-4444-444444440002'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-07T12:00:00Z'::timestamptz, 'Comercial', 0.20::numeric),
    ('44444444-4444-4444-4444-444444440003'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-12T12:00:00Z'::timestamptz, 'Comercial', 0.15::numeric),
    ('44444444-4444-4444-4444-444444440004'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-04T12:00:00Z'::timestamptz, 'Atendimento', 0.29::numeric),
    ('44444444-4444-4444-4444-444444440005'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-09T12:00:00Z'::timestamptz, 'Atendimento', 0.23::numeric),
    ('44444444-4444-4444-4444-444444440006'::uuid, '11111111-1111-1111-1111-111111111004'::uuid, '2026-02-16T12:00:00Z'::timestamptz, 'Atendimento', 0.17::numeric)
),
topic_baselines (survey_id, topic_id, base_score) as (
  values
    ('11111111-1111-1111-1111-111111111002'::uuid, 1, 2.20::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 2, 2.00::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 3, 2.70::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 4, 2.30::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 5, 2.10::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 6, 2.40::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 7, 2.20::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 8, 1.80::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 9, 2.00::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 10, 4.20::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 11, 2.50::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 12, 3.30::numeric),
    ('11111111-1111-1111-1111-111111111002'::uuid, 13, 3.90::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 1, 3.10::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 2, 2.80::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 3, 2.90::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 4, 2.50::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 5, 2.60::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 6, 2.70::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 7, 3.00::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 8, 3.80::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 9, 2.20::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 10, 4.00::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 11, 2.90::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 12, 3.70::numeric),
    ('11111111-1111-1111-1111-111111111003'::uuid, 13, 2.40::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 1, 3.90::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 2, 3.40::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 3, 2.80::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 4, 2.60::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 5, 3.20::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 6, 2.70::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 7, 3.10::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 8, 2.30::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 9, 2.10::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 10, 3.50::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 11, 3.80::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 12, 3.00::numeric),
    ('11111111-1111-1111-1111-111111111004'::uuid, 13, 2.90::numeric)
),
scored_answers as (
  select
    rs.id as response_id,
    q.id as question_id,
    q.scoring_rule,
    round(
      greatest(
        1::numeric,
        least(
          5::numeric,
          tb.base_score
          + rs.response_offset
          + (((q.position % 4)::numeric - 1.5) * 0.08)
        )
      ),
      4
    )::numeric(8,4) as corrected_value
  from response_seed rs
  join questions q
    on q.survey_id = rs.survey_id
   and q.is_active = true
  join topic_baselines tb
    on tb.survey_id = rs.survey_id
   and tb.topic_id = q.topic_id
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

insert into drps_assessments (
  id,
  survey_id,
  sector,
  psychologist_name,
  psychologist_crp,
  company_name,
  company_cnpj,
  reference_period,
  part1_answers,
  part1_dimension_scores,
  part1_probability_score,
  part1_probability_class,
  critical_topics,
  recommended_programs,
  governance_actions,
  notes,
  created_at
)
values
  (
    '55555555-5555-5555-5555-555555550001',
    '11111111-1111-1111-1111-111111111002',
    'Consolidado',
    'Dra Marina Costa',
    'CRP-06/123456',
    'TechCorp Brasil',
    '12.345.678/0001-90',
    '2026-Q1',
    '[
      {"key":"freq_regularidade","label":"Regularidade","score":4},
      {"key":"freq_duracao","label":"Duracao","score":4},
      {"key":"freq_impactados","label":"Impactados","score":3},
      {"key":"hist_registros","label":"Registros","score":3},
      {"key":"hist_gravidade","label":"Gravidade","score":3},
      {"key":"hist_causas","label":"Causas","score":3},
      {"key":"rec_medidas","label":"Medidas preventivas","score":2},
      {"key":"rec_revisao","label":"Revisao","score":2},
      {"key":"rec_conhecimento","label":"Conhecimento","score":3},
      {"key":"rec_recursos","label":"Recursos","score":2}
    ]'::jsonb,
    '{"frequency":3.67,"history":3.00,"resources":2.25,"resourcesRisk":3.75}'::jsonb,
    3.47,
    'medium',
    '[10,12,13]'::jsonb,
    '[
      "Programa de gestao do estresse e prevencao ao burnout",
      "Programa de prevencao e manejo da ansiedade",
      "Programa de saude mental e clima organizacional",
      "Programa de apoio psicologico",
      "Programa de psicologia positiva",
      "Programa de formacao de multiplicadores da cultura do cuidado",
      "Programa de treinamento a equipe de RH para implementacao da NR-01"
    ]'::jsonb,
    '[
      "Reuniao mensal de acompanhamento com liderancas",
      "Plano de redistribuicao de carga para areas criticas",
      "Reaplicacao do DRPS em 90 dias"
    ]'::jsonb,
    'Sobrecarga e isolamento em alta no recorte de tecnologia e financeiro.',
    '2026-02-18T14:00:00Z'::timestamptz
  ),
  (
    '55555555-5555-5555-5555-555555550002',
    '11111111-1111-1111-1111-111111111003',
    'Consolidado',
    'Dr Rafael Souza',
    'CRP-08/654321',
    'Industria Alfa',
    '98.765.432/0001-10',
    '2026-Q1',
    '[
      {"key":"freq_regularidade","label":"Regularidade","score":5},
      {"key":"freq_duracao","label":"Duracao","score":4},
      {"key":"freq_impactados","label":"Impactados","score":4},
      {"key":"hist_registros","label":"Registros","score":4},
      {"key":"hist_gravidade","label":"Gravidade","score":4},
      {"key":"hist_causas","label":"Causas","score":3},
      {"key":"rec_medidas","label":"Medidas preventivas","score":2},
      {"key":"rec_revisao","label":"Revisao","score":2},
      {"key":"rec_conhecimento","label":"Conhecimento","score":2},
      {"key":"rec_recursos","label":"Recursos","score":2}
    ]'::jsonb,
    '{"frequency":4.33,"history":3.67,"resources":2.00,"resourcesRisk":4.00}'::jsonb,
    4.00,
    'high',
    '[1,8,10,12]'::jsonb,
    '[
      "Programa de prevencao ao assedio moral e psicologico no trabalho",
      "Programa de inteligencia emocional para lideres",
      "Programa de gestao do estresse e prevencao ao burnout",
      "Programa de prevencao e manejo da ansiedade",
      "Programa de saude mental e clima organizacional",
      "Programa de apoio psicologico",
      "Programa de avaliacao psicologica com acompanhamento individualizado",
      "Programa de psicologia positiva",
      "Programa de formacao de multiplicadores da cultura do cuidado",
      "Programa de treinamento a equipe de RH para implementacao da NR-01"
    ]'::jsonb,
    '[
      "Plano de contingencia para eventos traumaticos",
      "Treinamento imediato de liderancas operacionais",
      "Auditoria interna do sistema psicossocial"
    ]'::jsonb,
    'Risco elevado em operacoes e manutencao com destaque para topicos 8, 10 e 12.',
    '2026-02-20T15:00:00Z'::timestamptz
  ),
  (
    '55555555-5555-5555-5555-555555550003',
    '11111111-1111-1111-1111-111111111004',
    'Consolidado',
    'Dra Paula Mendes',
    'CRP-04/112233',
    'Varejo Horizonte',
    '45.678.901/0001-22',
    '2026-Q1',
    '[
      {"key":"freq_regularidade","label":"Regularidade","score":4},
      {"key":"freq_duracao","label":"Duracao","score":4},
      {"key":"freq_impactados","label":"Impactados","score":3},
      {"key":"hist_registros","label":"Registros","score":3},
      {"key":"hist_gravidade","label":"Gravidade","score":4},
      {"key":"hist_causas","label":"Causas","score":3},
      {"key":"rec_medidas","label":"Medidas preventivas","score":3},
      {"key":"rec_revisao","label":"Revisao","score":2},
      {"key":"rec_conhecimento","label":"Conhecimento","score":3},
      {"key":"rec_recursos","label":"Recursos","score":2}
    ]'::jsonb,
    '{"frequency":3.67,"history":3.33,"resources":2.50,"resourcesRisk":3.50}'::jsonb,
    3.50,
    'medium',
    '[1,2,10,11]'::jsonb,
    '[
      "Programa de prevencao ao assedio moral e psicologico no trabalho",
      "Programa de inteligencia emocional para lideres",
      "Programa de gestao do estresse e prevencao ao burnout",
      "Programa de prevencao e manejo da ansiedade",
      "Programa de saude mental e clima organizacional",
      "Programa de apoio psicologico",
      "Programa de psicologia positiva",
      "Programa de formacao de multiplicadores da cultura do cuidado",
      "Programa de treinamento a equipe de RH para implementacao da NR-01"
    ]'::jsonb,
    '[
      "Criar comite de clima para unidades de atendimento",
      "Reforcar protocolo de denuncia e resposta rapida",
      "Reaplicacao setorial em 120 dias"
    ]'::jsonb,
    'Assedio e conflitos interpessoais persistem em comercial e atendimento.',
    '2026-02-22T16:00:00Z'::timestamptz
  )
on conflict (id) do update set
  survey_id = excluded.survey_id,
  sector = excluded.sector,
  psychologist_name = excluded.psychologist_name,
  psychologist_crp = excluded.psychologist_crp,
  company_name = excluded.company_name,
  company_cnpj = excluded.company_cnpj,
  reference_period = excluded.reference_period,
  part1_answers = excluded.part1_answers,
  part1_dimension_scores = excluded.part1_dimension_scores,
  part1_probability_score = excluded.part1_probability_score,
  part1_probability_class = excluded.part1_probability_class,
  critical_topics = excluded.critical_topics,
  recommended_programs = excluded.recommended_programs,
  governance_actions = excluded.governance_actions,
  notes = excluded.notes,
  created_at = excluded.created_at;
