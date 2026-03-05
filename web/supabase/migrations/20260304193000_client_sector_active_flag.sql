alter table client_sectors
  add column if not exists is_active boolean not null default true;

update client_sectors
set is_active = true
where is_active is null;
