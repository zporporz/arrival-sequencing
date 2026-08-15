-- Shared-link v1: browser clients using the publishable key may collaborate.
-- Trigger functions remain trigger-only and are not exposed as RPCs.

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.prepare_arrival() from public, anon, authenticated;
revoke execute on function public.audit_arrival_change() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable' and p.pronargs = 0
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

create policy "sessions readable by anon" on public.sequence_sessions for select to anon using (true);
create policy "sessions insertable by anon" on public.sequence_sessions for insert to anon with check (true);
create policy "sessions editable by anon" on public.sequence_sessions for update to anon using (true) with check (true);
create policy "fix timings readable by anon" on public.fix_timings for select to anon using (true);
create policy "arrivals readable by anon" on public.arrivals for select to anon using (true);
create policy "arrivals insertable by anon" on public.arrivals for insert to anon with check (true);
create policy "arrivals editable by anon" on public.arrivals for update to anon using (true) with check (true);
create policy "arrivals deletable by anon" on public.arrivals for delete to anon using (true);
create policy "audit logs readable by anon" on public.audit_logs for select to anon using (true);

grant usage on schema public to anon;
grant select, insert, update on public.sequence_sessions to anon;
grant select on public.fix_timings to anon;
grant select, insert, update, delete on public.arrivals to anon;
grant select on public.arrival_sequence_view to anon;
grant select on public.audit_logs to anon;
