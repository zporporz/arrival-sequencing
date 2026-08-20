alter table public.aircraft_performance_profiles
  add column if not exists performance_category text
  check (performance_category is null or performance_category in ('A','B','C','D','E','H'));

-- Force one upstream refresh for profiles cached before the category field existed.
update public.aircraft_performance_profiles
set last_checked_at = timestamptz '1970-01-01 00:00:00+00'
where performance_category is null;

comment on column public.aircraft_performance_profiles.performance_category is
  'ICAO aircraft performance/approach category from SimBrief airframe_options.per.';
