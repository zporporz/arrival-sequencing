-- Persist the current AUTO result selected at Return to AUTO time. Unlike the
-- pre-drag baseline, this value is the shared operational floor used by every
-- controller, including a browser that joins after the manual target is cleared.

alter table public.aman_flight_states
  add column if not exists auto_return_tldt timestamptz,
  add column if not exists auto_return_floor_tldt timestamptz,
  add column if not exists auto_return_runway text,
  add column if not exists auto_returned_at timestamptz,
  add column if not exists auto_returned_by_vid text,
  add column if not exists auto_returned_by_name text;

comment on column public.aman_flight_states.auto_return_tldt is
  'Shared current AUTO TLDT captured when the latest MANUAL target was cleared.';
comment on column public.aman_flight_states.auto_return_floor_tldt is
  'Shared not-before floor captured with the current AUTO return result.';
comment on column public.aman_flight_states.auto_return_runway is
  'Shared current AUTO runway captured when the latest MANUAL target was cleared.';
comment on column public.aman_flight_states.auto_returned_at is
  'UTC time at which the current shared AUTO return result was committed.';
