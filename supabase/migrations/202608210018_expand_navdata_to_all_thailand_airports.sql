alter table public.navdata_procedures drop constraint if exists navdata_procedures_airport_check;
alter table public.navdata_procedures add constraint navdata_procedures_airport_check check (airport ~ '^VT[A-Z0-9]{2}$');

create or replace function public.import_navdata_cycle(
  p_meta jsonb,
  p_procedures jsonb,
  p_transitions jsonb,
  p_legs jsonb,
  p_vid text,
  p_name text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_cycle text := nullif(trim(p_meta->>'cycle'), '');
  v_sha text := nullif(trim(p_meta->>'sourceSha256'), '');
  v_filename text := nullif(trim(p_meta->>'sourceFilename'), '');
  proc jsonb;
  trans jsonb;
  leg jsonb;
  v_proc_id bigint;
  v_transition_id bigint;
  v_constraint_count integer := 0;
begin
  if v_cycle is null or v_sha is null or v_filename is null then raise exception 'Cycle, source filename and SHA-256 are required'; end if;
  if jsonb_typeof(p_procedures) <> 'array' or jsonb_array_length(p_procedures) = 0 then raise exception 'No procedures supplied'; end if;
  if jsonb_array_length(p_procedures) > 1000 or jsonb_array_length(p_transitions) > 5000 or jsonb_array_length(p_legs) > 30000 then raise exception 'Navdata import exceeds safety limits'; end if;
  if exists (select 1 from public.navdata_cycles where source_sha256 = v_sha) then raise exception 'This SQLite file has already been imported'; end if;

  insert into public.navdata_cycles (cycle, valid_through, source_kind, source_filename, source_sha256, source_file_size, source_db_version_major, source_db_version_minor, source_data_source, status, procedure_count, transition_count, leg_count, constraint_leg_count, imported_by_vid, imported_by_name)
  values (v_cycle, nullif(trim(p_meta->>'validThrough'), ''), coalesce(nullif(trim(p_meta->>'sourceKind'), ''), 'LITTLE_NAVMAP_NAVIGRAPH'), v_filename, v_sha, nullif(p_meta->>'sourceFileSize', '')::bigint, nullif(p_meta->>'dbVersionMajor', '')::integer, nullif(p_meta->>'dbVersionMinor', '')::integer, nullif(trim(p_meta->>'dataSource'), ''), 'STAGED', jsonb_array_length(p_procedures), jsonb_array_length(p_transitions), jsonb_array_length(p_legs), 0, p_vid, p_name)
  returning id into v_cycle_id;

  for proc in select value from jsonb_array_elements(p_procedures) loop
    if upper(coalesce(proc->>'airport','')) !~ '^VT[A-Z0-9]{2}$' then raise exception 'Unsupported Thailand airport %', proc->>'airport'; end if;
    insert into public.navdata_procedures (cycle_id, airport, source_approach_id, designator, runway_name, arinc_name, source_type, source_suffix, aircraft_category, fingerprint, common_leg_count, transition_count)
    values (v_cycle_id, upper(proc->>'airport'), (proc->>'sourceApproachId')::bigint, upper(proc->>'designator'), nullif(proc->>'runwayName', ''), nullif(proc->>'arincName', ''), nullif(proc->>'sourceType', ''), nullif(proc->>'sourceSuffix', ''), nullif(proc->>'aircraftCategory', ''), proc->>'fingerprint', coalesce((proc->>'commonLegCount')::integer, 0), coalesce((proc->>'transitionCount')::integer, 0));
  end loop;

  for trans in select value from jsonb_array_elements(p_transitions) loop
    select id into v_proc_id from public.navdata_procedures where cycle_id = v_cycle_id and source_approach_id = (trans->>'sourceApproachId')::bigint;
    if v_proc_id is null then raise exception 'Transition references unknown approach %', trans->>'sourceApproachId'; end if;
    insert into public.navdata_transitions (cycle_id, procedure_id, source_transition_id, ident, source_type, aircraft_category, leg_count)
    values (v_cycle_id, v_proc_id, (trans->>'sourceTransitionId')::bigint, nullif(upper(trans->>'ident'), ''), nullif(trans->>'sourceType', ''), nullif(trans->>'aircraftCategory', ''), coalesce((trans->>'legCount')::integer, 0));
  end loop;

  for leg in select value from jsonb_array_elements(p_legs) loop
    select id into v_proc_id from public.navdata_procedures where cycle_id = v_cycle_id and source_approach_id = (leg->>'sourceApproachId')::bigint;
    if v_proc_id is null then raise exception 'Leg references unknown approach %', leg->>'sourceApproachId'; end if;
    v_transition_id := null;
    if nullif(leg->>'sourceTransitionId', '') is not null then
      select id into v_transition_id from public.navdata_transitions where cycle_id = v_cycle_id and source_transition_id = (leg->>'sourceTransitionId')::bigint;
      if v_transition_id is null then raise exception 'Leg references unknown transition %', leg->>'sourceTransitionId'; end if;
    end if;
    if nullif(leg->>'altDescriptor', '') is not null or nullif(leg->>'altitude1Ft', '') is not null or nullif(leg->>'altitude2Ft', '') is not null or nullif(leg->>'speedLimitKt', '') is not null then v_constraint_count := v_constraint_count + 1; end if;
    insert into public.navdata_procedure_legs (cycle_id, procedure_id, transition_id, leg_kind, leg_order, source_leg_id, path_terminator, arinc_descr_code, approach_fix_type, turn_direction, rnp, fix_type, fix_ident, fix_region, fix_airport_ident, fix_lon, fix_lat, recommended_fix_type, recommended_fix_ident, recommended_fix_region, recommended_fix_lon, recommended_fix_lat, is_flyover, is_true_course, course, distance_nm, leg_time_minutes, theta, rho, alt_descriptor, altitude1_ft, altitude2_ft, speed_limit_type, speed_limit_kt, vertical_angle)
    values (v_cycle_id, v_proc_id, v_transition_id, case when v_transition_id is null then 'COMMON' else 'TRANSITION' end, (leg->>'legOrder')::integer, (leg->>'sourceLegId')::bigint, nullif(leg->>'pathTerminator', ''), nullif(leg->>'arincDescrCode', ''), nullif(leg->>'approachFixType', ''), nullif(leg->>'turnDirection', ''), nullif(leg->>'rnp', '')::double precision, nullif(leg->>'fixType', ''), nullif(upper(leg->>'fixIdent'), ''), nullif(leg->>'fixRegion', ''), nullif(upper(leg->>'fixAirportIdent'), ''), nullif(leg->>'fixLon', '')::double precision, nullif(leg->>'fixLat', '')::double precision, nullif(leg->>'recommendedFixType', ''), nullif(upper(leg->>'recommendedFixIdent'), ''), nullif(leg->>'recommendedFixRegion', ''), nullif(leg->>'recommendedFixLon', '')::double precision, nullif(leg->>'recommendedFixLat', '')::double precision, coalesce((leg->>'isFlyover')::boolean, false), coalesce((leg->>'isTrueCourse')::boolean, false), nullif(leg->>'course', '')::double precision, nullif(leg->>'distanceNm', '')::double precision, nullif(leg->>'legTimeMinutes', '')::double precision, nullif(leg->>'theta', '')::double precision, nullif(leg->>'rho', '')::double precision, nullif(leg->>'altDescriptor', ''), nullif(leg->>'altitude1Ft', '')::double precision, nullif(leg->>'altitude2Ft', '')::double precision, nullif(leg->>'speedLimitType', ''), nullif(leg->>'speedLimitKt', '')::integer, nullif(leg->>'verticalAngle', '')::double precision);
  end loop;

  update public.navdata_cycles set constraint_leg_count = v_constraint_count where id = v_cycle_id;
  insert into public.navdata_events (cycle_id, cycle, action, actor_vid, actor_name, details)
  values (v_cycle_id, v_cycle, 'IMPORT', p_vid, p_name, jsonb_build_object('filename', v_filename, 'sha256', v_sha, 'procedures', jsonb_array_length(p_procedures), 'legs', jsonb_array_length(p_legs), 'scope', 'THAILAND'));
  return v_cycle_id;
exception when others then
  if v_cycle_id is not null then delete from public.navdata_cycles where id = v_cycle_id; end if;
  raise;
end;
$$;

grant execute on function public.import_navdata_cycle(jsonb, jsonb, jsonb, jsonb, text, text) to service_role;
