-- Canonical one-time AUTO target captured when live geometry first places an
-- aircraft inside 10 NM final. Server-side calculation uses the ICAO approach
-- category reference speed and the timestamp/distance of that live track sample.
alter table public.aman_flight_states
  add column if not exists frozen_tldt timestamptz,
  add column if not exists frozen_runway text,
  add column if not exists frozen_approach_category text,
  add column if not exists frozen_distance_nm numeric(6, 2),
  add column if not exists frozen_reference_speed_kt integer,
  add column if not exists frozen_track_at timestamptz,
  add column if not exists frozen_captured_at timestamptz,
  add column if not exists frozen_captured_by_vid text,
  add column if not exists frozen_captured_by_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_frozen_category_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_frozen_category_check
      check (frozen_approach_category is null or frozen_approach_category in ('A', 'B', 'C', 'D', 'E', 'H'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_frozen_distance_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_frozen_distance_check
      check (frozen_distance_nm is null or frozen_distance_nm between 0 and 10)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.aman_flight_states'::regclass
      and conname = 'aman_flight_states_frozen_speed_check'
  ) then
    alter table public.aman_flight_states
      add constraint aman_flight_states_frozen_speed_check
      check (frozen_reference_speed_kt is null or frozen_reference_speed_kt in (90, 120, 140, 165, 210))
      not valid;
  end if;
end $$;

alter table public.aman_flight_states
  validate constraint aman_flight_states_frozen_category_check;
alter table public.aman_flight_states
  validate constraint aman_flight_states_frozen_distance_check;
alter table public.aman_flight_states
  validate constraint aman_flight_states_frozen_speed_check;

comment on column public.aman_flight_states.frozen_tldt is
  'Canonical AUTO TLDT captured once at the 10 NM final FROZEN gate.';
comment on column public.aman_flight_states.frozen_approach_category is
  'ICAO approach category used for the FROZEN TLDT calculation.';
comment on column public.aman_flight_states.frozen_distance_nm is
  'Along-track final distance used for the FROZEN TLDT calculation.';
comment on column public.aman_flight_states.frozen_reference_speed_kt is
  'Conservative ICAO category reference speed used for the FROZEN TLDT calculation.';
