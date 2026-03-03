-- Continuous programs: add campaign materials, calendar frequency, questionnaire, and target metrics.

alter table if exists periodic_programs
  add column if not exists schedule_frequency varchar(24) not null default 'monthly',
  add column if not exists schedule_anchor_date date,
  add column if not exists evaluation_questions jsonb not null default '[]'::jsonb,
  add column if not exists materials jsonb not null default '[]'::jsonb,
  add column if not exists metrics jsonb not null default '{"participationTarget":80,"completionTarget":75,"adherenceTarget":70,"satisfactionTarget":4}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'periodic_programs_schedule_frequency_chk'
  ) then
    alter table periodic_programs
      add constraint periodic_programs_schedule_frequency_chk
      check (
        schedule_frequency in (
          'weekly',
          'biweekly',
          'monthly',
          'quarterly',
          'semiannual',
          'annual',
          'custom'
        )
      );
  end if;
end $$;

update periodic_programs
set evaluation_questions =
  '[
    "The campaign objectives were clear for participants.",
    "The content and materials were useful in day-to-day work.",
    "The campaign should continue in the next cycle."
  ]'::jsonb
where evaluation_questions is null
   or jsonb_typeof(evaluation_questions) <> 'array'
   or jsonb_array_length(evaluation_questions) = 0;

update periodic_programs
set materials = '[]'::jsonb
where materials is null
   or jsonb_typeof(materials) <> 'array';

update periodic_programs
set metrics = '{"participationTarget":80,"completionTarget":75,"adherenceTarget":70,"satisfactionTarget":4}'::jsonb
where metrics is null
   or jsonb_typeof(metrics) <> 'object';

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
      'program-materials',
      'program-materials',
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
        'image/jpeg'
      ]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
