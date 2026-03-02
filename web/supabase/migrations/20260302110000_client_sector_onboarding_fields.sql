alter table client_sectors
  add column if not exists functions text,
  add column if not exists workers_in_role int not null default 0,
  add column if not exists possible_mental_health_harms text,
  add column if not exists existing_control_measures text,
  add column if not exists elaboration_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_sectors_workers_in_role_non_negative'
  ) then
    alter table client_sectors
      add constraint client_sectors_workers_in_role_non_negative
      check (workers_in_role >= 0);
  end if;
end
$$;

update client_sectors
set workers_in_role = remote_workers + onsite_workers + hybrid_workers
where workers_in_role = 0;
