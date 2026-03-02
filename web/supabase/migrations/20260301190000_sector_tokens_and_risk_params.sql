create table if not exists survey_sectors (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  key text not null,
  name text not null,
  risk_parameter numeric(8,4) not null default 1.0000 check (risk_parameter between 0.5000 and 2.0000),
  access_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  is_active boolean not null default true,
  submission_count int not null default 0 check (submission_count >= 0),
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (survey_id, key),
  unique (survey_id, name)
);

alter table responses
  add column if not exists sector_id uuid references survey_sectors(id) on delete set null;

create index if not exists survey_sectors_survey_idx on survey_sectors (survey_id, is_active);
create index if not exists survey_sectors_token_idx on survey_sectors (access_token);
create index if not exists responses_survey_sector_idx on responses (survey_id, sector_id);

create or replace function bump_sector_submission(p_sector_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update survey_sectors
  set
    submission_count = submission_count + 1,
    last_submitted_at = now(),
    updated_at = now()
  where id = p_sector_id;
$$;
