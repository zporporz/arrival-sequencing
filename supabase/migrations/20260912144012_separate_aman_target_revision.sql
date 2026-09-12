-- Row revision still orders complete snapshots. Target revision orders only
-- sequencing commands, so new surveillance/FROZEN data cannot reject a drag.
alter table public.aman_flight_states
  add column if not exists target_revision bigint not null default 0
  check (target_revision >= 0);

create or replace function public.bump_aman_target_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.target_revision = 1;
  elsif row(new.canonical_session_id, new.target_mode, new.manual_tldt,
      new.manual_runway, new.manual_updated_at, new.auto_return_tldt,
      new.auto_return_floor_tldt, new.auto_return_runway, new.auto_returned_at,
      new.operational_state, new.operational_updated_at, new.reserved_gap_seconds,
      new.holding_mode, new.holding_fix, new.holding_leave_at,
      new.missed_approach_active, new.missed_approach_detected_at)
    is distinct from
    row(old.canonical_session_id, old.target_mode, old.manual_tldt,
      old.manual_runway, old.manual_updated_at, old.auto_return_tldt,
      old.auto_return_floor_tldt, old.auto_return_runway, old.auto_returned_at,
      old.operational_state, old.operational_updated_at, old.reserved_gap_seconds,
      old.holding_mode, old.holding_fix, old.holding_leave_at,
      old.missed_approach_active, old.missed_approach_detected_at) then
    new.target_revision = old.target_revision + 1;
  else
    new.target_revision = old.target_revision;
  end if;
  return new;
end;
$$;

create trigger aman_flight_states_target_revision
before insert or update on public.aman_flight_states
for each row execute function public.bump_aman_target_revision();

comment on column public.aman_flight_states.target_revision is
  'Atomic sequencing-command version. Unchanged for telemetry and FROZEN capture; full revision still orders snapshots.';
