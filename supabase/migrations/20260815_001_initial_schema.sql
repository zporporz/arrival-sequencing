-- Arrival Sequencing v1 database schema
-- Designed for Supabase Postgres + Realtime.
-- Public clients authenticate anonymously; RLS restricts browser access to authenticated users.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Utility: updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Controller profile (anonymous users still receive an auth.users UUID)
-- -----------------------------------------------------------------------------
create table if not exists public.controller_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.controller_profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      'ATC-' || upper(left(replace(new.id::text, '-', ''), 4))
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

create trigger controller_profiles_set_updated_at
before update on public.controller_profiles
for each row execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Sequencing session (normally one active workspace per airport/flow/event)
-- -----------------------------------------------------------------------------
create table if not exists public.sequence_sessions (
  id uuid primary key default gen_random_uuid(),
  airport text not null check (airport in ('VTBD', 'VTBS')),
  flow text not null,
  runway_config text,
  service_date date not null default ((now() at time zone 'utc')::date),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sequence_sessions_active_idx
  on public.sequence_sessions (airport, flow, service_date, status);

create trigger sequence_sessions_set_updated_at
before update on public.sequence_sessions
for each row execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Nominal fix -> landing time master
-- verified=false means the timing is usable as a provisional operational value,
-- but is not yet verified against the current timing model/source.
-- -----------------------------------------------------------------------------
create table if not exists public.fix_timings (
  id bigint generated always as identity primary key,
  airport text not null check (airport in ('VTBD', 'VTBS')),
  flow text not null,
  fix text not null,
  nominal_seconds integer not null check (nominal_seconds >= 0),
  source text not null,
  verified boolean not null default false,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fix_timings_dates_valid check (effective_to is null or effective_to >= effective_from),
  constraint fix_timings_unique_revision unique (airport, flow, fix, effective_from)
);

create index if not exists fix_timings_lookup_idx
  on public.fix_timings (airport, flow, fix, active, effective_from desc);

create trigger fix_timings_set_updated_at
before update on public.fix_timings
for each row execute procedure public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Arrival rows. ELDT and CTO are intentionally not stored:
--   ELDT = ETO + nominal_seconds_snapshot
--   CTO  = CLDT - nominal_seconds_snapshot
-- A timing snapshot is stored per flight so historical results do not change
-- when the master timing table is revised later.
-- -----------------------------------------------------------------------------
create table if not exists public.arrivals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sequence_sessions(id) on delete cascade,
  sequence_no integer not null default 0,
  callsign text not null,
  aircraft_type text,
  departure text,
  ref_fix text not null,
  eto timestamptz not null,
  nominal_seconds_snapshot integer not null check (nominal_seconds_snapshot >= 0),
  cldt timestamptz not null,
  aldt timestamptz,
  status text not null default 'SEQUENCED' check (status in ('INBOUND', 'SEQUENCED', 'LANDING', 'LANDED', 'CANCELLED')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arrivals_session_sequence_idx
  on public.arrivals (session_id, sequence_no, cldt);
create index if not exists arrivals_session_callsign_idx
  on public.arrivals (session_id, callsign);

-- Fill/refresh the timing snapshot when a row is inserted or its reference fix changes.
-- On INSERT, CLDT defaults to natural ELDT when the client sends NULL.
create or replace function public.prepare_arrival()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_airport text;
  v_flow text;
  v_service_date date;
  v_seconds integer;
begin
  new.callsign := upper(trim(new.callsign));
  new.aircraft_type := nullif(upper(trim(coalesce(new.aircraft_type, ''))), '');
  new.departure := nullif(upper(trim(coalesce(new.departure, ''))), '');
  new.ref_fix := upper(trim(new.ref_fix));

  if tg_op = 'INSERT'
     or new.session_id is distinct from old.session_id
     or new.ref_fix is distinct from old.ref_fix
     or new.nominal_seconds_snapshot is null then

    select s.airport, s.flow, s.service_date
      into v_airport, v_flow, v_service_date
    from public.sequence_sessions s
    where s.id = new.session_id;

    if v_airport is null then
      raise exception 'Unknown sequence session %', new.session_id;
    end if;

    select ft.nominal_seconds
      into v_seconds
    from public.fix_timings ft
    where ft.airport = v_airport
      and ft.flow = v_flow
      and ft.fix = new.ref_fix
      and ft.active = true
      and ft.effective_from <= v_service_date
      and (ft.effective_to is null or ft.effective_to >= v_service_date)
    order by ft.effective_from desc
    limit 1;

    if v_seconds is null then
      raise exception 'No active timing configured for % / flow % / fix % on %',
        v_airport, v_flow, new.ref_fix, v_service_date;
    end if;

    new.nominal_seconds_snapshot := v_seconds;
  end if;

  if tg_op = 'INSERT' and new.cldt is null then
    new.cldt := new.eto + make_interval(secs => new.nominal_seconds_snapshot);
  end if;

  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();

  return new;
end;
$$;

create trigger arrivals_prepare
before insert or update of session_id, callsign, aircraft_type, departure, ref_fix, eto, cldt, aldt, status, note, sequence_no
on public.arrivals
for each row execute procedure public.prepare_arrival();

-- -----------------------------------------------------------------------------
-- Read model used by the web app
-- -----------------------------------------------------------------------------
create or replace view public.arrival_sequence_view
with (security_invoker = true)
as
select
  a.id,
  a.session_id,
  s.airport,
  s.flow,
  s.runway_config,
  s.service_date,
  a.sequence_no,
  a.callsign,
  a.aircraft_type,
  a.departure,
  a.ref_fix,
  a.eto,
  a.nominal_seconds_snapshot,
  a.eto + make_interval(secs => a.nominal_seconds_snapshot) as eldt,
  a.cldt,
  a.cldt - make_interval(secs => a.nominal_seconds_snapshot) as cto,
  a.aldt,
  case
    when a.aldt is null then null
    else a.aldt - (a.eto + make_interval(secs => a.nominal_seconds_snapshot))
  end as est_var,
  case
    when a.aldt is null then null
    else a.aldt - a.cldt
  end as seq_var,
  a.status,
  a.note,
  a.created_by,
  a.updated_by,
  a.created_at,
  a.updated_at
from public.arrivals a
join public.sequence_sessions s on s.id = a.session_id;

-- -----------------------------------------------------------------------------
-- Audit history
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists audit_logs_record_idx
  on public.audit_logs (table_name, record_id, changed_at desc);

create or replace function public.audit_arrival_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (table_name, record_id, action, new_row, changed_by)
    values ('arrivals', new.id, 'INSERT', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (table_name, record_id, action, old_row, new_row, changed_by)
    values ('arrivals', new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (table_name, record_id, action, old_row, changed_by)
    values ('arrivals', old.id, 'DELETE', to_jsonb(old), auth.uid());
    return old;
  end if;
  return null;
end;
$$;

create trigger arrivals_audit
after insert or update or delete on public.arrivals
for each row execute procedure public.audit_arrival_change();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.controller_profiles enable row level security;
alter table public.sequence_sessions enable row level security;
alter table public.fix_timings enable row level security;
alter table public.arrivals enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles readable by authenticated"
on public.controller_profiles for select
to authenticated
using (true);

create policy "users update own profile"
on public.controller_profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sessions readable by authenticated"
on public.sequence_sessions for select
to authenticated
using (true);

create policy "sessions insertable by authenticated"
on public.sequence_sessions for insert
to authenticated
with check (true);

create policy "sessions editable by authenticated"
on public.sequence_sessions for update
to authenticated
using (true)
with check (true);

create policy "sessions deletable by authenticated"
on public.sequence_sessions for delete
to authenticated
using (true);

create policy "fix timings readable by authenticated"
on public.fix_timings for select
to authenticated
using (true);

create policy "arrivals readable by authenticated"
on public.arrivals for select
to authenticated
using (true);

create policy "arrivals insertable by authenticated"
on public.arrivals for insert
to authenticated
with check (true);

create policy "arrivals editable by authenticated"
on public.arrivals for update
to authenticated
using (true)
with check (true);

create policy "arrivals deletable by authenticated"
on public.arrivals for delete
to authenticated
using (true);

create policy "audit logs readable by authenticated"
on public.audit_logs for select
to authenticated
using (true);

-- Explicit Data API grants because the project is configured not to auto-expose tables.
grant usage on schema public to authenticated;
grant select, update on public.controller_profiles to authenticated;
grant select, insert, update, delete on public.sequence_sessions to authenticated;
grant select on public.fix_timings to authenticated;
grant select, insert, update, delete on public.arrivals to authenticated;
grant select on public.arrival_sequence_view to authenticated;
grant select on public.audit_logs to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: actual database row changes.
-- Presence / cell-edit indicators will use Realtime channels in the frontend.
-- -----------------------------------------------------------------------------
alter table public.arrivals replica identity full;
alter table public.sequence_sessions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'arrivals'
  ) then
    alter publication supabase_realtime add table public.arrivals;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sequence_sessions'
  ) then
    alter publication supabase_realtime add table public.sequence_sessions;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Provisional VTBD Flow 21 timing seed from the legacy sequencing workbook.
-- Waypoint TL has been renamed/replaced operationally by BLAFF at the same point.
-- These values are intentionally marked verified=false until the current timing
-- model is rebuilt/validated; the source is visible in the application.
-- -----------------------------------------------------------------------------
insert into public.fix_timings
  (airport, flow, fix, nominal_seconds, source, verified, effective_from)
values
  ('VTBD', '21', 'NAKON', 13 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'WEHHA', 13 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'ENDUU', 17 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'SABAI', 20 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'SEHNA', 25 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'HOTEL', 21 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'BLAFF', 18 * 60, 'Legacy VTBD sequencing workbook TL timing mapped to current BLAFF; provisional', false, '2026-01-01'),
  ('VTBD', '21', 'UBLOD', 19 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'ALEMI', 30 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'IBETO', 20 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'TARED', 20 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'NUGPA', 30 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'DULEM', 33 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'NOBER', 20 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'NODEG', 13 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01'),
  ('VTBD', '21', 'OPERA', 13 * 60, 'Legacy VTBD sequencing workbook; provisional timing', false, '2026-01-01')
on conflict (airport, flow, fix, effective_from) do update
set
  nominal_seconds = excluded.nominal_seconds,
  source = excluded.source,
  verified = excluded.verified,
  active = true,
  updated_at = now();
