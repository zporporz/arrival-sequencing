-- Shared Approach AMAN state for multi-controller target persistence,
-- holding advisories and 30-minute reconnect recovery.

create table if not exists public.aman_workspace_states (
  id uuid primary key default gen_random_uuid(),
  service_date date not null default ((now() at time zone 'utc')::date),
  airport text not null check (airport ~ '^[A-Z0-9]{4}$'),
  profile_id text not null,
  runway_modes jsonb not null default '{}'::jsonb check (jsonb_typeof(runway_modes) = 'object'),
  spacing_nm jsonb not null default '{}'::jsonb check (jsonb_typeof(spacing_nm) = 'object'),
  settings jsonb not null default '{"holdingThresholdMinutes":5,"speedAdvisoryEnabled":true}'::jsonb check (jsonb_typeof(settings) = 'object'),
  revision bigint not null default 1,
  updated_by_vid text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, airport)
);

create table if not exists public.aman_flight_states (
  id uuid primary key default gen_random_uuid(),
  service_date date not null default ((now() at time zone 'utc')::date),
  airport text not null check (airport ~ '^[A-Z0-9]{4}$'),
  callsign text not null,
  canonical_session_id text not null default gen_random_uuid()::text,
  raw_session_id text,
  vid text,
  flight_plan_id text,
  departure text,
  arrival text,
  aircraft_type text,
  route text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  last_seen_at timestamptz,
  disconnected_at timestamptz,
  connection_phase text not null default 'LIVE' check (connection_phase in ('LIVE','GHOST','RECONNECTED','POSITION_JUMP','EXPIRED')),
  reconnect_at timestamptz,
  jump_nm numeric(8,2),
  expected_nm numeric(8,2),
  target_mode text not null default 'AUTO' check (target_mode in ('AUTO','MANUAL')),
  manual_tldt timestamptz,
  manual_runway text,
  manual_updated_by_vid text,
  manual_updated_by_name text,
  manual_updated_at timestamptz,
  holding_mode text not null default 'AUTO' check (holding_mode in ('AUTO','HOLD','NO_HOLD')),
  holding_fix text,
  holding_leave_at timestamptz,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, airport, callsign),
  unique (canonical_session_id)
);

create index if not exists aman_workspace_states_service_airport_idx
  on public.aman_workspace_states (service_date, airport);
create index if not exists aman_flight_states_service_airport_idx
  on public.aman_flight_states (service_date, airport);
create index if not exists aman_flight_states_connection_idx
  on public.aman_flight_states (service_date, airport, connection_phase, last_seen_at desc);
create index if not exists aman_flight_states_raw_session_idx
  on public.aman_flight_states (raw_session_id);

create or replace function public.bump_aman_state_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.revision = coalesce(old.revision, 0) + 1;
  return new;
end;
$$;

drop trigger if exists aman_workspace_states_touch on public.aman_workspace_states;
create trigger aman_workspace_states_touch
before update on public.aman_workspace_states
for each row execute function public.bump_aman_state_revision();

drop trigger if exists aman_flight_states_touch on public.aman_flight_states;
create trigger aman_flight_states_touch
before update on public.aman_flight_states
for each row execute function public.bump_aman_state_revision();

alter table public.aman_workspace_states enable row level security;
alter table public.aman_flight_states enable row level security;

drop policy if exists "aman workspace states readable by anon" on public.aman_workspace_states;
create policy "aman workspace states readable by anon"
on public.aman_workspace_states for select to anon using (true);

drop policy if exists "aman workspace states readable by authenticated" on public.aman_workspace_states;
create policy "aman workspace states readable by authenticated"
on public.aman_workspace_states for select to authenticated using (true);

drop policy if exists "aman flight states readable by anon" on public.aman_flight_states;
create policy "aman flight states readable by anon"
on public.aman_flight_states for select to anon using (true);

drop policy if exists "aman flight states readable by authenticated" on public.aman_flight_states;
create policy "aman flight states readable by authenticated"
on public.aman_flight_states for select to authenticated using (true);

grant select on public.aman_workspace_states to anon, authenticated;
grant select on public.aman_flight_states to anon, authenticated;
grant all on public.aman_workspace_states to service_role;
grant all on public.aman_flight_states to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aman_workspace_states'
  ) then
    alter publication supabase_realtime add table public.aman_workspace_states;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aman_flight_states'
  ) then
    alter publication supabase_realtime add table public.aman_flight_states;
  end if;
end
$$;

comment on table public.aman_workspace_states is
  'Shared Approach AMAN runway configuration and operational settings per UTC service date and airport.';
comment on table public.aman_flight_states is
  'Shared Approach AMAN target ownership, reconnect recovery and holding state per flight.';
