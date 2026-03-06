create table if not exists client_company_risk_profile_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  questionnaire_version text not null,
  sector text,
  notes text,
  answers_json jsonb not null,
  factor_scores jsonb not null,
  summary_counts jsonb not null,
  overall_score numeric(6,2) not null,
  overall_class text not null check (overall_class in ('baixa', 'media', 'alta')),
  created_by_role text not null default 'manager' check (created_by_role in ('manager', 'client')),
  created_by_email text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(answers_json) = 'object'),
  check (jsonb_typeof(factor_scores) = 'array'),
  check (jsonb_typeof(summary_counts) = 'object'),
  check (overall_score >= 1 and overall_score <= 3)
);

create index if not exists client_company_risk_profile_reports_client_idx
  on client_company_risk_profile_reports (client_id, created_at desc);
