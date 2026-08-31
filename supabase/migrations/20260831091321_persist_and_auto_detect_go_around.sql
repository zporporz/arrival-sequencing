-- Persist both the short-final arming observation and an active missed approach.
-- This lets the server detect a final-to-climb transition and lets controllers who
-- open AMAN later reconstruct the same reinserted flight from shared state.
alter table public.aman_flight_states
  add column if not exists ga_armed_at timestamptz,
  add column if not exists ga_armed_runway text,
  add column if not exists ga_armed_altitude_ft integer,
  add column if not exists ga_armed_track_at timestamptz,
  add column if not exists missed_approach_active boolean not null default false,
  add column if not exists missed_approach_source text,
  add column if not exists missed_approach_detected_at timestamptz,
  add column if not exists missed_approach_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_missed_approach_source_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_missed_approach_source_check
      check (missed_approach_source is null or missed_approach_source in ('MANUAL', 'AUTO'))
      not valid;
  end if;
end $$;

alter table public.aman_flight_states
  validate constraint aman_flight_states_missed_approach_source_check;

comment on column public.aman_flight_states.ga_armed_at is
  'Latest live observation inside an aligned 10 NM final, used to arm automatic GA detection.';
comment on column public.aman_flight_states.missed_approach_active is
  'Shared GA/reinsert marker used by all current and late-joining controller browsers.';
comment on column public.aman_flight_states.missed_approach_source is
  'Whether the active GA was requested by a controller or detected from live track movement.';
