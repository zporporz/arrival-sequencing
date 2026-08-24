-- Explicit AMAN sequence order shared by every controller/browser.
-- One row represents the complete order for one airport/runway, so a reorder is
-- published atomically instead of as several independently updated flight ranks.

create table if not exists public.aman_sequence_orders (
  id uuid primary key default gen_random_uuid(),
  service_date date not null default ((now() at time zone 'utc')::date),
  airport text not null check (airport ~ '^[A-Z0-9]{4}$'),
  runway text not null check (runway ~ '^[A-Z0-9]{1,12}$'),
  ordered_callsigns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ordered_callsigns) = 'array'),
  revision bigint not null default 1,
  updated_by_vid text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_date, airport, runway)
);

create index if not exists aman_sequence_orders_service_airport_idx
  on public.aman_sequence_orders (service_date, airport, runway);

drop trigger if exists aman_sequence_orders_touch on public.aman_sequence_orders;
create trigger aman_sequence_orders_touch
before update on public.aman_sequence_orders
for each row execute function public.bump_aman_state_revision();

alter table public.aman_sequence_orders enable row level security;

drop policy if exists "aman sequence orders readable by anon" on public.aman_sequence_orders;
create policy "aman sequence orders readable by anon"
on public.aman_sequence_orders for select to anon using (true);

drop policy if exists "aman sequence orders readable by authenticated" on public.aman_sequence_orders;
create policy "aman sequence orders readable by authenticated"
on public.aman_sequence_orders for select to authenticated using (true);

grant select on public.aman_sequence_orders to anon, authenticated;
grant all on public.aman_sequence_orders to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aman_sequence_orders'
  ) then
    alter publication supabase_realtime add table public.aman_sequence_orders;
  end if;
end
$$;

comment on table public.aman_sequence_orders is
  'Atomic shared AMAN callsign order per UTC service date, airport and landing runway.';
