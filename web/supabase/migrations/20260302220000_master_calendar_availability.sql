-- Master calendar events + client availability requests for continuous programs.

create table if not exists calendar_events (
  event_id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(client_id) on delete cascade,
  source_client_program_id uuid references client_programs(client_program_id) on delete cascade,
  event_type text not null check (event_type in ('continuous_meeting', 'blocked')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists calendar_events_client_idx
  on calendar_events (client_id, starts_at);

create index if not exists calendar_events_source_program_idx
  on calendar_events (source_client_program_id, starts_at);

create table if not exists client_program_availability_requests (
  request_id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  client_program_id uuid not null references client_programs(client_program_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'scheduled', 'closed')),
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  suggested_slots jsonb not null default '[]'::jsonb,
  selected_slots jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_program_id)
);

create index if not exists client_program_availability_requests_client_idx
  on client_program_availability_requests (client_id, status, requested_at desc);
