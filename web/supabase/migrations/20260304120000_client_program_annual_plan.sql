-- Annual month plan selection for assigned continuous programs.

alter table if exists client_programs
  add column if not exists annual_plan_months jsonb not null default '[]'::jsonb;

alter table if exists client_programs
  drop constraint if exists client_programs_annual_plan_months_type_check;

alter table if exists client_programs
  add constraint client_programs_annual_plan_months_type_check
  check (jsonb_typeof(annual_plan_months) = 'array');
