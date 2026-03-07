-- Continuous programs: add session blocks so each assignment event can map to a specific session.

alter table if exists periodic_programs
  add column if not exists sessions jsonb not null default '[]'::jsonb;

alter table if exists periodic_programs
  drop constraint if exists periodic_programs_sessions_type_check;

alter table if exists periodic_programs
  add constraint periodic_programs_sessions_type_check
  check (jsonb_typeof(sessions) = 'array');

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'periodic_programs'
      and column_name = 'materials'
  ) then
    update periodic_programs
    set sessions = case
      when jsonb_typeof(materials) = 'array' and jsonb_array_length(materials) > 0 then
        jsonb_build_array(
          jsonb_build_object(
            'id', 'session-1',
            'title', 'Sessao 1',
            'notes', null,
            'preparationRequired', null,
            'materials', materials
          )
        )
      else
        jsonb_build_array(
          jsonb_build_object(
            'id', 'session-1',
            'title', 'Sessao 1',
            'notes', null,
            'preparationRequired', null,
            'materials', '[]'::jsonb
          )
        )
      end
    where sessions is null
       or jsonb_typeof(sessions) <> 'array'
       or jsonb_array_length(sessions) = 0;
  else
    update periodic_programs
    set sessions = jsonb_build_array(
      jsonb_build_object(
        'id', 'session-1',
        'title', 'Sessao 1',
        'notes', null,
        'preparationRequired', null,
        'materials', '[]'::jsonb
      )
    )
    where sessions is null
       or jsonb_typeof(sessions) <> 'array'
       or jsonb_array_length(sessions) = 0;
  end if;
end $$;
