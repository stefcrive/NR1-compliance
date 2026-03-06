alter table if exists client_company_risk_profile_progress
  add column if not exists next_cycle_available_at timestamptz;

create index if not exists client_company_risk_profile_progress_next_cycle_idx
  on client_company_risk_profile_progress (next_cycle_available_at);
