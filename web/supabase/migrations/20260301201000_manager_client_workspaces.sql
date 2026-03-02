create extension if not exists pgcrypto;

alter table clients
  add column if not exists portal_slug text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists remote_employees int not null default 0,
  add column if not exists onsite_employees int not null default 0,
  add column if not exists hybrid_employees int not null default 0,
  add column if not exists billing_status text not null default 'pending',
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_headcount_non_negative'
  ) then
    alter table clients
      add constraint clients_headcount_non_negative
      check (
        remote_employees >= 0
        and onsite_employees >= 0
        and hybrid_employees >= 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_headcount_total_check'
  ) then
    alter table clients
      add constraint clients_headcount_total_check
      check (
        remote_employees + onsite_employees + hybrid_employees <= total_employees
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_billing_status_check'
  ) then
    alter table clients
      add constraint clients_billing_status_check
      check (billing_status in ('up_to_date', 'pending', 'overdue', 'blocked'));
  end if;
end
$$;

with normalized as (
  select
    c.client_id,
    coalesce(
      nullif(
        trim(both '-' from lower(regexp_replace(c.company_name, '[^a-zA-Z0-9]+', '-', 'g'))),
        ''
      ),
      'client'
    ) as base_slug
  from clients c
),
ranked as (
  select
    n.client_id,
    case
      when count(*) over (partition by n.base_slug) = 1 then n.base_slug
      else n.base_slug || '-' || row_number() over (partition by n.base_slug order by n.client_id)
    end as final_slug
  from normalized n
)
update clients c
set portal_slug = r.final_slug
from ranked r
where c.client_id = r.client_id
  and (c.portal_slug is null or c.portal_slug = '');

create unique index if not exists clients_portal_slug_idx on clients (portal_slug);

create table if not exists client_sectors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  key text not null,
  name text not null,
  remote_workers int not null default 0 check (remote_workers >= 0),
  onsite_workers int not null default 0 check (onsite_workers >= 0),
  hybrid_workers int not null default 0 check (hybrid_workers >= 0),
  risk_parameter numeric(8,4) not null default 1.0000 check (risk_parameter between 0.5000 and 2.0000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, key),
  unique (client_id, name)
);

create index if not exists client_sectors_client_idx on client_sectors (client_id, created_at);

alter table surveys
  add column if not exists client_id uuid references clients(client_id) on delete set null;

create index if not exists surveys_client_idx on surveys (client_id, status, created_at desc);

create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(client_id) on delete cascade,
  survey_id uuid references surveys(id) on delete set null,
  report_title text not null,
  status text not null default 'ready' check (status in ('draft', 'processing', 'ready', 'failed')),
  generated_by text not null default 'manager',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_reports_client_idx on client_reports (client_id, created_at desc);
create index if not exists client_reports_survey_idx on client_reports (survey_id, created_at desc);