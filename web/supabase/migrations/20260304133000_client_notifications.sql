-- Notifications visible in the client workspace, triggered by manager actions.

create table if not exists client_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  notification_type text not null check (notification_type in (
    'manager_drps_assigned',
    'manager_program_assigned',
    'manager_report_issued'
  )),
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_notifications_created_idx
  on client_notifications (created_at desc);

create index if not exists client_notifications_client_idx
  on client_notifications (client_id, created_at desc);

create index if not exists client_notifications_read_idx
  on client_notifications (client_id, is_read, created_at desc);
