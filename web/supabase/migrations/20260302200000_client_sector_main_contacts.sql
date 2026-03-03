alter table client_sectors
  add column if not exists main_contact_name text,
  add column if not exists main_contact_email text,
  add column if not exists main_contact_phone text;
