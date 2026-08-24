-- Target only the SECURITY DEFINER functions reported by Supabase advisors.
-- Browser clients no longer use direct Supabase RPC; backend service_role keeps
-- access for server workflows and trigger execution remains unaffected.

revoke execute on function public.audit_fix_timing_config() from public, anon, authenticated;
revoke execute on function public.audit_master_config() from public, anon, authenticated;
revoke execute on function public.audit_sequence_session_config() from public, anon, authenticated;
revoke execute on function public.authorize_and_claim_aman_flight_index_collector(text, integer) from public, anon, authenticated;
revoke execute on function public.finish_aman_flight_index_collector(text, boolean, text) from public, anon, authenticated;
revoke execute on function public.renumber_arrival_sequence(uuid) from public, anon, authenticated;
revoke execute on function public.sync_arrival_sequence_order() from public, anon, authenticated;

grant execute on function public.audit_fix_timing_config() to service_role;
grant execute on function public.audit_master_config() to service_role;
grant execute on function public.audit_sequence_session_config() to service_role;
grant execute on function public.authorize_and_claim_aman_flight_index_collector(text, integer) to service_role;
grant execute on function public.finish_aman_flight_index_collector(text, boolean, text) to service_role;
grant execute on function public.renumber_arrival_sequence(uuid) to service_role;
grant execute on function public.sync_arrival_sequence_order() to service_role;

alter function public.set_master_updated_at() set search_path = public;

notify pgrst, 'reload schema';
