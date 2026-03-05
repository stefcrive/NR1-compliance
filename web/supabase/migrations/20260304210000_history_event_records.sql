-- Event history records: persistent notes + attachments for calendar and DRPS events.

create table if not exists history_event_records (
  event_id text primary key,
  client_id uuid references clients(client_id) on delete set null,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by text not null default 'manager'
);

create index if not exists history_event_records_client_updated_idx
  on history_event_records (client_id, updated_at desc);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'event-record-files',
      'event-record-files',
      true,
      15728640,
      array[
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/csv',
        'image/png',
        'image/jpeg',
        'image/webp'
      ]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
