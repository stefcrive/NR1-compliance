create table if not exists client_company_risk_profile_progress (
  client_id uuid primary key references clients(client_id) on delete cascade,
  questionnaire_version text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  answers_json jsonb not null default '{}'::jsonb,
  completion_ratio numeric(5,4) not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_saved_at timestamptz,
  last_skipped_at timestamptz,
  last_reminder_at timestamptz,
  latest_report_id uuid references client_company_risk_profile_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(answers_json) = 'object'),
  check (completion_ratio >= 0 and completion_ratio <= 1)
);

create index if not exists client_company_risk_profile_progress_status_idx
  on client_company_risk_profile_progress (status, updated_at desc);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'client_notifications_notification_type_check'
  ) then
    alter table client_notifications
      drop constraint client_notifications_notification_type_check;
  end if;

  alter table client_notifications
    add constraint client_notifications_notification_type_check
    check (
      notification_type in (
        'manager_drps_assigned',
        'manager_program_assigned',
        'manager_report_issued',
        'company_risk_profile_reminder'
      )
    );
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'manager_notifications_notification_type_check'
  ) then
    alter table manager_notifications
      drop constraint manager_notifications_notification_type_check;
  end if;

  alter table manager_notifications
    add constraint manager_notifications_notification_type_check
    check (
      notification_type in (
        'client_reschedule_submitted',
        'client_report_downloaded',
        'client_company_risk_profile_completed'
      )
    );
end
$$;
