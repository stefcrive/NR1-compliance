alter table clients
  add column if not exists absenteeism_rate numeric(5,2),
  add column if not exists turnover_rate numeric(5,2),
  add column if not exists mental_health_leave_cases int,
  add column if not exists organizational_climate_reports text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_absenteeism_rate_range'
  ) then
    alter table clients
      add constraint clients_absenteeism_rate_range
      check (absenteeism_rate is null or (absenteeism_rate >= 0 and absenteeism_rate <= 100));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_turnover_rate_range'
  ) then
    alter table clients
      add constraint clients_turnover_rate_range
      check (turnover_rate is null or (turnover_rate >= 0 and turnover_rate <= 100));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_mental_health_leave_cases_non_negative'
  ) then
    alter table clients
      add constraint clients_mental_health_leave_cases_non_negative
      check (mental_health_leave_cases is null or mental_health_leave_cases >= 0);
  end if;
end
$$;

alter table client_sectors
  add column if not exists shifts text,
  add column if not exists vulnerable_groups text;
