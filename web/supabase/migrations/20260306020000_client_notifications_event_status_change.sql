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
        'company_risk_profile_reminder',
        'manager_calendar_event_status_changed'
      )
    );
end
$$;
