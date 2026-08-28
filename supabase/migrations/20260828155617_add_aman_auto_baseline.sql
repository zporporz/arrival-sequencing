-- Keep the AUTO position that existed when a controller first changed a flight
-- to MANUAL. This is shared server-side so a controller who opens the board
-- later has the same return-to-AUTO reference as the controller who dragged it.

alter table public.aman_flight_states
  add column if not exists auto_baseline_tldt timestamptz,
  add column if not exists auto_baseline_runway text,
  add column if not exists auto_baseline_rank integer,
  add column if not exists auto_baseline_captured_at timestamptz;

alter table public.aman_flight_states
  drop constraint if exists aman_flight_states_auto_baseline_rank_check;

alter table public.aman_flight_states
  add constraint aman_flight_states_auto_baseline_rank_check
  check (auto_baseline_rank is null or auto_baseline_rank > 0)
  not valid;

alter table public.aman_flight_states
  validate constraint aman_flight_states_auto_baseline_rank_check;

comment on column public.aman_flight_states.auto_baseline_tldt is
  'AUTO TLDT immediately before the current MANUAL targeting session began.';
comment on column public.aman_flight_states.auto_baseline_runway is
  'AUTO runway immediately before the current MANUAL targeting session began.';
comment on column public.aman_flight_states.auto_baseline_rank is
  'AUTO sequence rank immediately before the current MANUAL targeting session began.';
comment on column public.aman_flight_states.auto_baseline_captured_at is
  'UTC time at which the current MANUAL session AUTO baseline was captured.';
