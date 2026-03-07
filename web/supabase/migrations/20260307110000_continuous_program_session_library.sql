create table if not exists public.continuous_program_session_library (
  session_library_id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text null,
  preparation_required text null,
  materials jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint continuous_program_session_library_title_len
    check (char_length(btrim(title)) between 1 and 240),
  constraint continuous_program_session_library_notes_len
    check (notes is null or char_length(notes) <= 5000),
  constraint continuous_program_session_library_preparation_len
    check (preparation_required is null or char_length(preparation_required) <= 1500),
  constraint continuous_program_session_library_materials_array
    check (jsonb_typeof(materials) = 'array')
);

create index if not exists continuous_program_session_library_created_at_idx
  on public.continuous_program_session_library (created_at desc);

create index if not exists continuous_program_session_library_title_idx
  on public.continuous_program_session_library (title);

