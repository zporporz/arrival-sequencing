-- Keep operational state changes reproducible from migrations. These columns
-- already exist on some deployed databases, so every change is idempotent.
alter table public.aman_flight_states
  add column if not exists operational_state text not null default 'NORMAL',
  add column if not exists reserved_gap_seconds integer not null default 0,
  add column if not exists operational_updated_by_vid text,
  add column if not exists operational_updated_by_name text,
  add column if not exists operational_updated_at timestamptz;

update public.aman_flight_states
set operational_state = 'NORMAL'
where operational_state is null;

update public.aman_flight_states
set reserved_gap_seconds = 0
where reserved_gap_seconds is null;

alter table public.aman_flight_states
  alter column operational_state set default 'NORMAL',
  alter column operational_state set not null,
  alter column reserved_gap_seconds set default 0,
  alter column reserved_gap_seconds set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_operational_state_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_operational_state_check
      check (operational_state in ('NORMAL', 'MISSED_APPROACH', 'DESEQUENCED', 'REMOVED'))
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_reserved_gap_seconds_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_reserved_gap_seconds_check
      check (reserved_gap_seconds between 0 and 600)
      not valid;
  end if;
end
$$;

alter table public.aman_flight_states
  validate constraint aman_flight_states_operational_state_check;

alter table public.aman_flight_states
  validate constraint aman_flight_states_reserved_gap_seconds_check;

comment on column public.aman_flight_states.operational_state is
  'Controller-set lifecycle state used for missed approach, desequencing and removal.';
comment on column public.aman_flight_states.reserved_gap_seconds is
  'Extra controller-reserved spacing after this flight, constrained to 0-600 seconds.';
