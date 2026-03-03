-- Per-assignment cadence overrides for continuous programs.

alter table if exists client_programs
  add column if not exists schedule_frequency_override text,
  add column if not exists schedule_anchor_date_override date;

alter table if exists client_programs
  drop constraint if exists client_programs_schedule_frequency_override_check;

alter table if exists client_programs
  add constraint client_programs_schedule_frequency_override_check
  check (
    schedule_frequency_override is null
    or schedule_frequency_override in (
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'semiannual',
      'annual',
      'custom'
    )
  );
