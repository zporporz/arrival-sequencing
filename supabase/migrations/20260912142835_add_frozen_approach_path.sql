-- Additive only: existing captures remain canonical and are not recalculated.
alter table public.aman_flight_states
  add column if not exists frozen_path_distance_nm numeric(6,2)
    check (frozen_path_distance_nm between 0 and 30),
  add column if not exists frozen_approach_path text;

comment on column public.aman_flight_states.frozen_distance_nm is
  '10 NM gate distance: radial threshold distance for approach-path captures; along-track distance for legacy aligned Final captures.';
comment on column public.aman_flight_states.frozen_path_distance_nm is
  'Remaining published approach polyline distance used with category speed for Frozen TLDT; null for legacy aligned Final captures.';
comment on column public.aman_flight_states.frozen_approach_path is
  'AIRAC:approach/transition used for geometric EST. Not an ATC clearance.';
