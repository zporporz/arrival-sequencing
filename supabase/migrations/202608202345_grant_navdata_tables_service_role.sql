grant select, insert, update, delete on table public.navdata_cycles to service_role;
grant select, insert, update, delete on table public.navdata_procedures to service_role;
grant select, insert, update, delete on table public.navdata_transitions to service_role;
grant select, insert, update, delete on table public.navdata_procedure_legs to service_role;
grant select, insert, update, delete on table public.navdata_events to service_role;
grant usage, select on all sequences in schema public to service_role;
