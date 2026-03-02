-- Manager mock data + DRPS simulation (20 employees).
-- Requires migration 20260301201000_manager_client_workspaces.sql.

-- Enrich baseline client profiles used by manager and client workspaces.
update clients
set
  remote_employees = 58,
  onsite_employees = 72,
  hybrid_employees = 20,
  billing_status = 'up_to_date',
  contact_name = 'Ana Ribeiro',
  contact_email = 'ana.ribeiro@techcorp.com.br',
  contact_phone = '+55 11 98888-1001',
  contract_start_date = '2026-01-01',
  contract_end_date = '2026-12-31',
  updated_at = now()
where client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001';

update clients
set
  remote_employees = 30,
  onsite_employees = 360,
  hybrid_employees = 30,
  billing_status = 'overdue',
  contact_name = 'Carlos Mendes',
  contact_email = 'carlos.mendes@industriaalfa.com.br',
  contact_phone = '+55 31 97777-2002',
  contract_start_date = '2026-01-01',
  contract_end_date = '2026-12-31',
  updated_at = now()
where client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002';

update clients
set
  remote_employees = 25,
  onsite_employees = 170,
  hybrid_employees = 35,
  billing_status = 'pending',
  contact_name = 'Fernanda Luz',
  contact_email = 'fernanda.luz@varejohorizonte.com.br',
  contact_phone = '+55 21 96666-3003',
  contract_start_date = '2026-01-01',
  contract_end_date = '2026-12-31',
  updated_at = now()
where client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003';

insert into clients (
  client_id,
  company_name,
  cnpj,
  total_employees,
  status,
  portal_slug,
  remote_employees,
  onsite_employees,
  hybrid_employees,
  billing_status,
  contact_name,
  contact_email,
  contact_phone,
  contract_start_date,
  contract_end_date,
  updated_at
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005',
    'Servicos Orion',
    '11.222.333/0001-44',
    90,
    'Active',
    'servicos-orion',
    18,
    60,
    12,
    'up_to_date',
    'Marcos Vieira',
    'marcos.vieira@orion.com.br',
    '+55 41 95555-4004',
    '2026-01-01',
    '2026-12-31',
    now()
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006',
    'Construtora Aurora',
    '66.777.888/0001-99',
    260,
    'Pending',
    'construtora-aurora',
    12,
    220,
    28,
    'pending',
    'Paulo Teixeira',
    'paulo.teixeira@aurora.com.br',
    '+55 51 94444-5005',
    '2026-02-01',
    '2027-01-31',
    now()
  )
on conflict (client_id) do update set
  company_name = excluded.company_name,
  cnpj = excluded.cnpj,
  total_employees = excluded.total_employees,
  status = excluded.status,
  portal_slug = excluded.portal_slug,
  remote_employees = excluded.remote_employees,
  onsite_employees = excluded.onsite_employees,
  hybrid_employees = excluded.hybrid_employees,
  billing_status = excluded.billing_status,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  contract_start_date = excluded.contract_start_date,
  contract_end_date = excluded.contract_end_date,
  updated_at = now();

insert into invoices (invoice_id, client_id, amount, status, due_date)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005', 3900.00, 'Paid', '2026-03-03'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005', 3900.00, 'Pending', '2026-04-03'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006', 5400.00, 'Pending', '2026-03-25')
on conflict (invoice_id) do update set
  client_id = excluded.client_id,
  amount = excluded.amount,
  status = excluded.status,
  due_date = excluded.due_date;

-- Sector templates per client (used when manager assigns DRPS).
insert into client_sectors (
  id,
  client_id,
  key,
  name,
  remote_workers,
  onsite_workers,
  hybrid_workers,
  risk_parameter,
  updated_at
)
values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'tecnologia', 'Tecnologia', 42, 12, 8, 1.25, now()),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'financeiro', 'Financeiro', 8, 30, 6, 1.10, now()),
  ('a1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'comercial', 'Comercial', 8, 24, 6, 0.95, now()),
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 'operacoes', 'Operacoes', 6, 210, 10, 1.30, now()),
  ('a2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 'manutencao', 'Manutencao', 2, 90, 6, 1.20, now()),
  ('a2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 'seguranca', 'Seguranca', 2, 40, 4, 1.15, now()),
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003', 'comercial', 'Comercial', 10, 70, 12, 1.12, now()),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003', 'atendimento', 'Atendimento', 8, 74, 14, 1.08, now()),
  ('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003', 'rh', 'RH', 7, 26, 9, 0.92, now()),
  ('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005', 'operacoes', 'Operacoes', 4, 42, 6, 1.05, now()),
  ('a5000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005', 'suporte', 'Suporte', 10, 12, 6, 1.00, now())
on conflict (id) do update set
  key = excluded.key,
  name = excluded.name,
  remote_workers = excluded.remote_workers,
  onsite_workers = excluded.onsite_workers,
  hybrid_workers = excluded.hybrid_workers,
  risk_parameter = excluded.risk_parameter,
  updated_at = now();

-- Link existing seeded campaigns to clients for manager metrics.
update surveys set client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001' where id = '11111111-1111-1111-1111-111111111002';
update surveys set client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002' where id = '11111111-1111-1111-1111-111111111003';
update surveys set client_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003' where id = '11111111-1111-1111-1111-111111111004';

-- Dedicated simulation campaign: DRPS risk assessment for 20 employees.
insert into surveys (
  id,
  client_id,
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
values (
  '11111111-1111-1111-1111-111111111020',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001',
  'TechCorp Brasil - DRPS 2026 Q2 (Simulacao 20 colaboradores)',
  'techcorp-brasil-2026-q2-sim-20',
  'live',
  1,
  5,
  5,
  30,
  '1x00000000000000000000AA',
  'localhost'
)
on conflict (id) do update set
  client_id = excluded.client_id,
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

-- Clone questionnaire and grouping model from demo survey.
insert into survey_group_dimensions (survey_id, key, label, is_required)
select
  '11111111-1111-1111-1111-111111111020'::uuid,
  d.key,
  d.label,
  d.is_required
from survey_group_dimensions d
where d.survey_id = '11111111-1111-1111-1111-111111111001'
on conflict (survey_id, key) do update set
  label = excluded.label,
  is_required = excluded.is_required;

with source_options as (
  select d.key, o.value, o.label, o.sort_order
  from survey_group_dimensions d
  join survey_group_options o on o.dimension_id = d.id
  where d.survey_id = '11111111-1111-1111-1111-111111111001'
),
target_dimensions as (
  select d.id, d.key
  from survey_group_dimensions d
  where d.survey_id = '11111111-1111-1111-1111-111111111020'
)
insert into survey_group_options (dimension_id, value, label, sort_order)
select td.id, so.value, so.label, so.sort_order
from target_dimensions td
join source_options so on so.key = td.key
on conflict (dimension_id, value) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

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
  '11111111-1111-1111-1111-111111111020'::uuid,
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

insert into survey_sectors (
  id,
  survey_id,
  key,
  name,
  risk_parameter,
  access_token,
  is_active,
  submission_count,
  last_submitted_at,
  updated_at
)
values
  ('77000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111020', 'tecnologia', 'Tecnologia', 1.25, 'tc-q2-sim20-tech-token-01', true, 0, null, now()),
  ('77000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111020', 'financeiro', 'Financeiro', 1.10, 'tc-q2-sim20-fin-token-02', true, 0, null, now()),
  ('77000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111020', 'comercial', 'Comercial', 0.95, 'tc-q2-sim20-com-token-03', true, 0, null, now())
on conflict (id) do update set
  key = excluded.key,
  name = excluded.name,
  risk_parameter = excluded.risk_parameter,
  access_token = excluded.access_token,
  is_active = excluded.is_active,
  updated_at = now();

insert into survey_group_options (dimension_id, value, label, sort_order)
select
  d.id,
  s.name,
  s.name,
  case s.key when 'tecnologia' then 1 when 'financeiro' then 2 else 3 end
from survey_group_dimensions d
join survey_sectors s on s.survey_id = d.survey_id
where d.survey_id = '11111111-1111-1111-1111-111111111020'
  and d.key = 'sector'
on conflict (dimension_id, value) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

-- 20 employee submissions distributed across 3 sectors.
with respondents as (
  select
    gs as employee_idx,
    case
      when gs <= 8 then 'tecnologia'
      when gs <= 14 then 'financeiro'
      else 'comercial'
    end as sector_key,
    case
      when gs <= 8 then 'Tecnologia'
      when gs <= 14 then 'Financeiro'
      else 'Comercial'
    end as sector_name,
    case
      when gs <= 8 then 0.24::numeric
      when gs <= 14 then 0.18::numeric
      else 0.12::numeric
    end as response_offset,
    (
      substr(md5(concat('tc20-response-', gs::text)), 1, 8)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 9, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 13, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 17, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 21, 12)
    )::uuid as response_id,
    (
      substr(md5(concat('tc20-sid-', gs::text)), 1, 8)
      || '-'
      || substr(md5(concat('tc20-sid-', gs::text)), 9, 4)
      || '-'
      || substr(md5(concat('tc20-sid-', gs::text)), 13, 4)
      || '-'
      || substr(md5(concat('tc20-sid-', gs::text)), 17, 4)
      || '-'
      || substr(md5(concat('tc20-sid-', gs::text)), 21, 12)
    )::uuid as sid,
    (timestamp with time zone '2026-03-01 09:00:00+00' + ((gs - 1) * interval '6 hours')) as submitted_at
  from generate_series(1, 20) as gs
),
sector_map as (
  select id, key
  from survey_sectors
  where survey_id = '11111111-1111-1111-1111-111111111020'
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
  '11111111-1111-1111-1111-111111111020'::uuid,
  r.submitted_at,
  r.sid,
  null,
  jsonb_build_object(
    'sector', r.sector_name,
    'role', case when (r.employee_idx % 4) = 0 then 'lideranca' else 'analista' end,
    'sector_key', r.sector_key
  ),
  '[]'::jsonb,
  sm.id
from respondents r
join sector_map sm on sm.key = r.sector_key
on conflict (id) do update set
  survey_id = excluded.survey_id,
  submitted_at = excluded.submitted_at,
  session_sid = excluded.session_sid,
  group_values = excluded.group_values,
  answers_json = excluded.answers_json,
  sector_id = excluded.sector_id;

with respondents as (
  select
    gs as employee_idx,
    case
      when gs <= 8 then 0.24::numeric
      when gs <= 14 then 0.18::numeric
      else 0.12::numeric
    end as response_offset,
    (
      substr(md5(concat('tc20-response-', gs::text)), 1, 8)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 9, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 13, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 17, 4)
      || '-'
      || substr(md5(concat('tc20-response-', gs::text)), 21, 12)
    )::uuid as response_id
  from generate_series(1, 20) as gs
),
topic_baselines (topic_id, base_score) as (
  values
    (1, 2.35::numeric),
    (2, 2.10::numeric),
    (3, 2.60::numeric),
    (4, 2.20::numeric),
    (5, 2.15::numeric),
    (6, 2.45::numeric),
    (7, 2.25::numeric),
    (8, 1.95::numeric),
    (9, 2.05::numeric),
    (10, 4.10::numeric),
    (11, 2.50::numeric),
    (12, 3.25::numeric),
    (13, 3.70::numeric)
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
          + r.response_offset
          + (((q.position % 5)::numeric - 2) * 0.07)
        )
      ),
      4
    )::numeric(8,4) as corrected_value
  from respondents r
  join questions q
    on q.survey_id = '11111111-1111-1111-1111-111111111020'
   and q.is_active = true
  join topic_baselines tb on tb.topic_id = q.topic_id
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
where r.id = rp.response_id;

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
values (
  '88000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111020',
  'Consolidado',
  'Dra Marina Costa',
  'CRP-06/123456',
  'TechCorp Brasil',
  '12.345.678/0001-90',
  '2026-Q2',
  '[
    {"key":"freq_regularidade","label":"Regularidade","score":4},
    {"key":"freq_duracao","label":"Duracao","score":4},
    {"key":"freq_impactados","label":"Impactados","score":4},
    {"key":"hist_registros","label":"Registros","score":3},
    {"key":"hist_gravidade","label":"Gravidade","score":3},
    {"key":"hist_causas","label":"Causas","score":3},
    {"key":"rec_medidas","label":"Medidas preventivas","score":2},
    {"key":"rec_revisao","label":"Revisao","score":2},
    {"key":"rec_conhecimento","label":"Conhecimento","score":3},
    {"key":"rec_recursos","label":"Recursos","score":2}
  ]'::jsonb,
  '{"frequency":4.00,"history":3.00,"resources":2.25,"resourcesRisk":3.75}'::jsonb,
  3.58,
  'medium',
  '[10,12,13]'::jsonb,
  '[
    "Programa de gestao do estresse e prevencao ao burnout",
    "Programa de prevencao e manejo da ansiedade",
    "Programa de saude mental e clima organizacional",
    "Programa de apoio psicologico",
    "Programa de treinamento a equipe de RH para implementacao da NR-01"
  ]'::jsonb,
  '[
    "Reuniao mensal de acompanhamento",
    "Reaplicacao do DRPS em 90 dias",
    "Comite multidisciplinar integrado"
  ]'::jsonb,
  'Simulacao com 20 colaboradores: risco alto em sobrecarga (T10) e comunicacao dificil (T12).',
  '2026-03-08T14:30:00Z'::timestamptz
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

insert into client_reports (
  id,
  client_id,
  survey_id,
  report_title,
  status,
  generated_by,
  summary,
  created_at
)
values (
  '99000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001',
  '11111111-1111-1111-1111-111111111020',
  'Relatorio DRPS simulado - TechCorp Q2 (20 colaboradores)',
  'ready',
  'manager',
  '{
    "source":"mock-seed",
    "employees_assessed":20,
    "priority_topics":[10,12,13],
    "note":"Relatorio sem PDF para simulacao funcional do dashboard"
  }'::jsonb,
  '2026-03-08T15:00:00Z'::timestamptz
)
on conflict (id) do update set
  client_id = excluded.client_id,
  survey_id = excluded.survey_id,
  report_title = excluded.report_title,
  status = excluded.status,
  generated_by = excluded.generated_by,
  summary = excluded.summary,
  created_at = excluded.created_at;