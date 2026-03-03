-- Internal manager notifications triggered by client actions.

create table if not exists manager_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(client_id) on delete set null,
  notification_type text not null check (notification_type in (
    'client_reschedule_submitted',
    'client_report_downloaded'
  )),
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists manager_notifications_created_idx
  on manager_notifications (created_at desc);

create index if not exists manager_notifications_read_idx
  on manager_notifications (is_read, created_at desc);

create index if not exists manager_notifications_client_idx
  on manager_notifications (client_id, created_at desc);
