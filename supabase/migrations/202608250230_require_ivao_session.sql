-- All operational browser access must pass through an API that validates the
-- signed IVAO session cookie. The browser no longer receives direct Data API or
-- Postgres Changes access through Supabase's publishable key.

create table if not exists public.aman_online_presence (
  presence_key text primary key check (char_length(presence_key) between 1 and 128),
  vid text not null,
  display_name text not null,
  role_label text,
  staff_positions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(staff_positions) = 'array'),
  airport_view text,
  online_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists aman_online_presence_last_seen_idx
  on public.aman_online_presence (last_seen_at desc);

alter table public.aman_online_presence enable row level security;
revoke all privileges on public.aman_online_presence from anon, authenticated;
grant all privileges on public.aman_online_presence to service_role;

drop policy if exists "sessions readable by anon" on public.sequence_sessions;
drop policy if exists "sessions insertable by anon" on public.sequence_sessions;
drop policy if exists "sessions editable by anon" on public.sequence_sessions;
drop policy if exists "fix timings readable by anon" on public.fix_timings;
drop policy if exists "arrivals readable by anon" on public.arrivals;
drop policy if exists "arrivals insertable by anon" on public.arrivals;
drop policy if exists "arrivals editable by anon" on public.arrivals;
drop policy if exists "arrivals deletable by anon" on public.arrivals;
drop policy if exists "audit logs readable by anon" on public.audit_logs;

drop policy if exists "profiles readable by authenticated" on public.controller_profiles;
drop policy if exists "users update own profile" on public.controller_profiles;
drop policy if exists "sessions readable by authenticated" on public.sequence_sessions;
drop policy if exists "sessions insertable by authenticated" on public.sequence_sessions;
drop policy if exists "sessions editable by authenticated" on public.sequence_sessions;
drop policy if exists "sessions deletable by authenticated" on public.sequence_sessions;
drop policy if exists "fix timings readable by authenticated" on public.fix_timings;
drop policy if exists "arrivals readable by authenticated" on public.arrivals;
drop policy if exists "arrivals insertable by authenticated" on public.arrivals;
drop policy if exists "arrivals editable by authenticated" on public.arrivals;
drop policy if exists "arrivals deletable by authenticated" on public.arrivals;
drop policy if exists "audit logs readable by authenticated" on public.audit_logs;

drop policy if exists "aman workspace states readable by anon" on public.aman_workspace_states;
drop policy if exists "aman workspace states readable by authenticated" on public.aman_workspace_states;
drop policy if exists "aman flight states readable by anon" on public.aman_flight_states;
drop policy if exists "aman flight states readable by authenticated" on public.aman_flight_states;
drop policy if exists "aman sequence orders readable by anon" on public.aman_sequence_orders;
drop policy if exists "aman sequence orders readable by authenticated" on public.aman_sequence_orders;

revoke all privileges on public.controller_profiles from anon, authenticated;
revoke all privileges on public.sequence_sessions from anon, authenticated;
revoke all privileges on public.fix_timings from anon, authenticated;
revoke all privileges on public.arrivals from anon, authenticated;
revoke all privileges on public.arrival_sequence_view from anon, authenticated;
revoke all privileges on public.audit_logs from anon, authenticated;
revoke all privileges on public.aman_workspace_states from anon, authenticated;
revoke all privileges on public.aman_flight_states from anon, authenticated;
revoke all privileges on public.aman_sequence_orders from anon, authenticated;

-- Backend API requests use service_role and remain the sole operational data path.
grant all privileges on public.sequence_sessions to service_role;
grant all privileges on public.fix_timings to service_role;
grant all privileges on public.arrivals to service_role;
grant select on public.arrival_sequence_view to service_role;
grant all privileges on public.audit_logs to service_role;
grant all privileges on public.aman_workspace_states to service_role;
grant all privileges on public.aman_flight_states to service_role;
grant all privileges on public.aman_sequence_orders to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'arrivals'
  ) then alter publication supabase_realtime drop table public.arrivals; end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sequence_sessions'
  ) then alter publication supabase_realtime drop table public.sequence_sessions; end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aman_workspace_states'
  ) then alter publication supabase_realtime drop table public.aman_workspace_states; end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aman_flight_states'
  ) then alter publication supabase_realtime drop table public.aman_flight_states; end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aman_sequence_orders'
  ) then alter publication supabase_realtime drop table public.aman_sequence_orders; end if;
end
$$;

comment on table public.aman_online_presence is
  'Authenticated IVAO website presence; accessible only through the session-protected backend API.';
