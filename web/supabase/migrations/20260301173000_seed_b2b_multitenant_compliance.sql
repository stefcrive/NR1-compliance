-- Multi-tenant B2B compliance schema + mock data for report generation.
-- This migration is independent from the survey-based MVP schema.

create table if not exists clients (
  client_id uuid primary key,
  company_name varchar(255) not null,
  cnpj varchar(18) not null unique,
  total_employees int not null check (total_employees >= 1),
  status varchar(50) not null check (status in ('Active', 'Pending', 'Inactive'))
);

create table if not exists invoices (
  invoice_id uuid primary key,
  client_id uuid not null references clients(client_id) on delete cascade,
  amount decimal(10, 2) not null check (amount >= 0),
  status varchar(50) not null check (status in ('Paid', 'Pending', 'Overdue')),
  due_date date not null
);

create table if not exists drps_campaigns (
  campaign_id uuid primary key,
  client_id uuid not null references clients(client_id) on delete cascade,
  campaign_name varchar(255) not null,
  status varchar(50) not null check (status in ('Draft', 'Active', 'Completed')),
  start_date date not null,
  end_date date,
  unique_link_token varchar(255) not null unique
);

create table if not exists employee_responses (
  response_id uuid primary key,
  campaign_id uuid not null references drps_campaigns(campaign_id) on delete cascade,
  department varchar(100) not null,
  topic_id int not null check (topic_id between 1 and 13),
  calculated_risk_score decimal(5, 2) not null check (calculated_risk_score between 1.0 and 3.0),
  submitted_at timestamptz not null default now()
);

create table if not exists periodic_programs (
  program_id uuid primary key,
  title varchar(255) not null,
  description text,
  target_risk_topic int not null check (target_risk_topic between 1 and 13),
  trigger_threshold decimal(5, 2) not null check (trigger_threshold between 1.0 and 3.0)
);

create table if not exists client_programs (
  client_program_id uuid primary key,
  client_id uuid not null references clients(client_id) on delete cascade,
  program_id uuid not null references periodic_programs(program_id) on delete cascade,
  status varchar(50) not null check (status in ('Recommended', 'Active', 'Completed')),
  deployed_at timestamptz not null default now()
);

create index if not exists invoices_client_idx on invoices (client_id, due_date desc);
create index if not exists drps_campaigns_client_idx on drps_campaigns (client_id, status);
create index if not exists drps_campaigns_token_idx on drps_campaigns (unique_link_token);
create index if not exists employee_responses_campaign_idx on employee_responses (campaign_id, department);
create index if not exists employee_responses_topic_idx on employee_responses (campaign_id, topic_id);
create index if not exists client_programs_client_idx on client_programs (client_id, status);

insert into clients (client_id, company_name, cnpj, total_employees, status)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 'TechCorp Brasil', '12.345.678/0001-90', 150, 'Active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 'Industria Alfa', '98.765.432/0001-10', 420, 'Active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003', 'Varejo Horizonte', '45.678.901/0001-22', 230, 'Active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004', 'Logistica Delta', '22.334.556/0001-77', 310, 'Pending')
on conflict (client_id) do update set
  company_name = excluded.company_name,
  cnpj = excluded.cnpj,
  total_employees = excluded.total_employees,
  status = excluded.status;

insert into invoices (invoice_id, client_id, amount, status, due_date)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 4500.00, 'Paid', '2026-03-01'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001', 4500.00, 'Pending', '2026-04-01'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 8200.00, 'Pending', '2026-03-15'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002', 8200.00, 'Overdue', '2026-02-15'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003', 6100.00, 'Paid', '2026-03-05'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb1006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004', 7000.00, 'Pending', '2026-03-20')
on conflict (invoice_id) do update set
  client_id = excluded.client_id,
  amount = excluded.amount,
  status = excluded.status,
  due_date = excluded.due_date;

insert into drps_campaigns (
  campaign_id,
  client_id,
  campaign_name,
  status,
  start_date,
  end_date,
  unique_link_token
)
values
  (
    'cccccccc-cccc-cccc-cccc-cccccccc2001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001',
    'DRPS 2026 - Q1',
    'Completed',
    '2026-01-10',
    '2026-02-15',
    'tc-2026-q1-xyz'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccc2002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002',
    'DRPS 2026 - Q1',
    'Completed',
    '2026-01-12',
    '2026-02-20',
    'ia-2026-q1-xyz'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccc2003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003',
    'DRPS 2026 - Q1',
    'Completed',
    '2026-01-15',
    '2026-02-22',
    'vh-2026-q1-xyz'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccc2004',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004',
    'DRPS 2026 - Q1',
    'Active',
    '2026-02-01',
    null,
    'ld-2026-q1-xyz'
  )
on conflict (campaign_id) do update set
  client_id = excluded.client_id,
  campaign_name = excluded.campaign_name,
  status = excluded.status,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  unique_link_token = excluded.unique_link_token;

with periodic_seed (program_id, title, description, target_risk_topic, trigger_threshold) as (
  values
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3001'::uuid,
      'Programa de prevencao ao assedio',
      'Treinamento e governanca para prevencao ao assedio moral e psicologico.',
      1,
      2.20::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3002'::uuid,
      'Programa de suporte psicologico',
      'Rede estruturada de apoio com atendimento psicologico e acolhimento.',
      2,
      2.40::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3003'::uuid,
      'Programa de gestao de mudancas',
      'Plano de comunicacao e suporte para periodos de mudanca organizacional.',
      3,
      2.40::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3004'::uuid,
      'Programa de clareza de papeis e autonomia',
      'Ajustes de processos para clareza de funcao e autonomia operacional.',
      4,
      2.40::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3005'::uuid,
      'Programa de reconhecimento e cultura',
      'Praticas recorrentes de reconhecimento e feedback da lideranca.',
      5,
      2.40::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3006'::uuid,
      'Programa de gestao do estresse e burnout',
      'Intervencoes para reducao de sobrecarga e prevencao de burnout.',
      10,
      2.50::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3007'::uuid,
      'Programa de comunicacao e relacionamento',
      'Acao integrada para conflitos interpessoais e comunicacao dificil.',
      11,
      2.50::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3008'::uuid,
      'Programa de apoio a eventos traumaticos',
      'Protocolo de resposta para exposicao a eventos violentos/traumaticos.',
      8,
      2.50::numeric
    ),
    (
      'dddddddd-dddd-dddd-dddd-dddddddd3009'::uuid,
      'Programa de integracao remoto/isolado',
      'Acoes de pertencimento e suporte para trabalhadores remotos e isolados.',
      13,
      2.50::numeric
    )
)
insert into periodic_programs (program_id, title, description, target_risk_topic, trigger_threshold)
select
  ps.program_id,
  ps.title,
  ps.description,
  ps.target_risk_topic,
  ps.trigger_threshold
from periodic_seed ps
on conflict (program_id) do update set
  title = excluded.title,
  description = excluded.description,
  target_risk_topic = excluded.target_risk_topic,
  trigger_threshold = excluded.trigger_threshold;

with campaign_departments (campaign_id, department, department_order, dept_offset, start_date) as (
  values
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 'Financeiro', 1, 0.08::numeric, '2026-01-10'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 'Operacoes', 2, 0.15::numeric, '2026-01-10'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 'Tecnologia', 3, 0.22::numeric, '2026-01-10'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 'Operacoes', 1, 0.16::numeric, '2026-01-12'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 'Manutencao', 2, 0.20::numeric, '2026-01-12'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 'Seguranca', 3, 0.12::numeric, '2026-01-12'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 'Comercial', 1, 0.18::numeric, '2026-01-15'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 'Atendimento', 2, 0.22::numeric, '2026-01-15'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 'RH', 3, 0.10::numeric, '2026-01-15'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 'Operacoes', 1, 0.06::numeric, '2026-02-01'::date),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 'Logistica', 2, 0.09::numeric, '2026-02-01'::date)
),
topic_seed (campaign_id, topic_id, base_score) as (
  values
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 1, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 2, 1.95::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 3, 2.25::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 4, 2.10::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 5, 2.00::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 6, 2.20::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 7, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 8, 1.80::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 9, 1.90::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 10, 2.70::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 11, 2.20::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 12, 2.45::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2001'::uuid, 13, 2.60::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 1, 2.50::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 2, 2.35::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 3, 2.40::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 4, 2.20::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 5, 2.25::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 6, 2.30::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 7, 2.40::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 8, 2.70::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 9, 2.00::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 10, 2.80::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 11, 2.35::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 12, 2.65::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2002'::uuid, 13, 2.20::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 1, 2.65::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 2, 2.45::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 3, 2.30::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 4, 2.20::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 5, 2.50::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 6, 2.25::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 7, 2.35::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 8, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 9, 1.95::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 10, 2.55::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 11, 2.65::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 12, 2.35::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2003'::uuid, 13, 2.40::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 1, 2.00::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 2, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 3, 2.15::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 4, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 5, 2.00::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 6, 2.10::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 7, 2.05::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 8, 1.90::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 9, 1.85::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 10, 2.30::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 11, 2.15::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 12, 2.40::numeric),
    ('cccccccc-cccc-cccc-cccc-cccccccc2004'::uuid, 13, 2.20::numeric)
),
response_matrix as (
  select
    cd.campaign_id,
    cd.department,
    ts.topic_id,
    gs.sample_idx,
    md5(
      concat(
        cd.campaign_id::text,
        '|',
        cd.department,
        '|',
        ts.topic_id::text,
        '|',
        gs.sample_idx::text
      )
    ) as h,
    round(
      greatest(
        1.00::numeric,
        least(
          3.00::numeric,
          ts.base_score
          + cd.dept_offset
          + ((gs.sample_idx::numeric - 1.5) * 0.08)
        )
      ),
      2
    ) as score,
    (
      cd.start_date::timestamp
      + make_interval(days => cd.department_order + (ts.topic_id % 6) + gs.sample_idx * 2)
    )::timestamptz as submitted_at
  from campaign_departments cd
  join topic_seed ts on ts.campaign_id = cd.campaign_id
  cross join generate_series(1, 2) as gs(sample_idx)
)
insert into employee_responses (
  response_id,
  campaign_id,
  department,
  topic_id,
  calculated_risk_score,
  submitted_at
)
select
  (
    substr(rm.h, 1, 8)
    || '-'
    || substr(rm.h, 9, 4)
    || '-'
    || substr(rm.h, 13, 4)
    || '-'
    || substr(rm.h, 17, 4)
    || '-'
    || substr(rm.h, 21, 12)
  )::uuid as response_id,
  rm.campaign_id,
  rm.department,
  rm.topic_id,
  rm.score,
  rm.submitted_at
from response_matrix rm
on conflict (response_id) do update set
  campaign_id = excluded.campaign_id,
  department = excluded.department,
  topic_id = excluded.topic_id,
  calculated_risk_score = excluded.calculated_risk_score,
  submitted_at = excluded.submitted_at;

with campaign_topic_avg as (
  select
    c.client_id,
    er.topic_id,
    avg(er.calculated_risk_score)::numeric(5,2) as mean_topic_score,
    max(c.end_date)::timestamp as deployed_at
  from employee_responses er
  join drps_campaigns c on c.campaign_id = er.campaign_id
  where c.status = 'Completed'
  group by c.client_id, er.topic_id
),
matched_programs as (
  select
    cta.client_id,
    pp.program_id,
    cta.deployed_at,
    md5(concat(cta.client_id::text, '|', pp.program_id::text)) as h
  from campaign_topic_avg cta
  join periodic_programs pp
    on pp.target_risk_topic = cta.topic_id
   and cta.mean_topic_score >= pp.trigger_threshold
)
insert into client_programs (client_program_id, client_id, program_id, status, deployed_at)
select
  (
    substr(mp.h, 1, 8)
    || '-'
    || substr(mp.h, 9, 4)
    || '-'
    || substr(mp.h, 13, 4)
    || '-'
    || substr(mp.h, 17, 4)
    || '-'
    || substr(mp.h, 21, 12)
  )::uuid as client_program_id,
  mp.client_id,
  mp.program_id,
  'Recommended'::varchar(50),
  coalesce(mp.deployed_at, now())
from matched_programs mp
on conflict (client_program_id) do update set
  client_id = excluded.client_id,
  program_id = excluded.program_id,
  status = excluded.status,
  deployed_at = excluded.deployed_at;

update client_programs
set status = 'Active'
where (client_id, program_id) in (
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid, 'dddddddd-dddd-dddd-dddd-dddddddd3006'::uuid),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'::uuid, 'dddddddd-dddd-dddd-dddd-dddddddd3008'::uuid)
);

update client_programs
set status = 'Completed'
where (client_id, program_id) in (
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003'::uuid, 'dddddddd-dddd-dddd-dddd-dddddddd3001'::uuid)
);
