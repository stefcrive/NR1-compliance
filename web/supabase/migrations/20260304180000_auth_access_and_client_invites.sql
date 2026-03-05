create extension if not exists pgcrypto;

create table if not exists client_access_credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  login_email text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create unique index if not exists client_access_credentials_login_email_idx
  on client_access_credentials (lower(login_email));

create table if not exists client_access_invitations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  invitation_token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_email text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create index if not exists client_access_invitations_status_idx
  on client_access_invitations (status, expires_at desc);
