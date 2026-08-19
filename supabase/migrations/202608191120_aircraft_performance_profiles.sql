-- Persistent aircraft performance cache for AMAN ETA modelling.
-- SimBrief remains the upstream source; operational ETA reads from this table first.

create table if not exists public.aircraft_performance_profiles (
  aircraft_type text primary key check (aircraft_type ~ '^[A-Z0-9]{2,8}$'),
  aircraft_name text,
  source text not null default 'SIMBRIEF' check (source in ('SIMBRIEF')),
  descent_profile text not null,
  descent_mach numeric(5,3),
  descent_ias_kt integer not null check (descent_ias_kt between 100 and 450),
  descent_below_10000_ias_kt integer not null check (descent_below_10000_ias_kt between 100 and 350),
  aircraft_default_cruise text,
  aircraft_speed text,
  source_updated_at timestamptz,
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aircraft_performance_profiles_checked_idx
  on public.aircraft_performance_profiles (last_checked_at);

create or replace function public.touch_aircraft_performance_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists aircraft_performance_profiles_touch on public.aircraft_performance_profiles;
create trigger aircraft_performance_profiles_touch
before update on public.aircraft_performance_profiles
for each row execute function public.touch_aircraft_performance_profile();

alter table public.aircraft_performance_profiles enable row level security;
revoke all on public.aircraft_performance_profiles from anon, authenticated;
grant all on public.aircraft_performance_profiles to service_role;

comment on table public.aircraft_performance_profiles is
  'Persistent SimBrief aircraft descent profiles used by AMAN ETA calculations. Backend checks upstream periodically and updates only when source values change.';
