-- Persist recently landed arrivals so they remain visible below ACTUAL after IVAO
-- removes them from the live inbound feed.

alter table public.aman_flight_states
  add column if not exists landed_at timestamptz;

alter table public.aman_flight_states
  drop constraint if exists aman_flight_states_connection_phase_check;

alter table public.aman_flight_states
  add constraint aman_flight_states_connection_phase_check
  check (connection_phase in ('LIVE','GHOST','RECONNECTED','POSITION_JUMP','LANDED','EXPIRED'));

create index if not exists aman_flight_states_landed_idx
  on public.aman_flight_states (service_date, airport, landed_at desc)
  where connection_phase = 'LANDED';

create table if not exists public.aman_landed_history (
  id uuid primary key default gen_random_uuid(),
  service_date date not null default ((now() at time zone 'utc')::date),
  airport text not null check (airport ~ '^[A-Z0-9]{4}$'),
  callsign text not null,
  raw_session_id text not null,
  vid text,
  aircraft_type text,
  departure text,
  arrival text,
  route text,
  landed_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, airport, callsign, raw_session_id)
);

create index if not exists aman_landed_history_recent_idx
  on public.aman_landed_history (service_date, airport, landed_at desc);

create or replace function public.touch_aman_landed_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists aman_landed_history_touch on public.aman_landed_history;
create trigger aman_landed_history_touch
before update on public.aman_landed_history
for each row execute function public.touch_aman_landed_history();

alter table public.aman_landed_history enable row level security;
revoke all on public.aman_landed_history from anon, authenticated;
grant all on public.aman_landed_history to service_role;

comment on table public.aman_landed_history is
  'Observed IVAO touchdown/landing history retained for the AMAN post-ACTUAL timeline.';
