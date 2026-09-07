const PROCEDURE_FIELDS = [
  'airport', 'designator', 'runway_name', 'arinc_name', 'source_type',
  'source_suffix', 'aircraft_category',
];

const TRANSITION_FIELDS = ['ident', 'source_type', 'aircraft_category'];

const LEG_FIELDS = [
  'leg_kind', 'leg_order', 'path_terminator', 'arinc_descr_code',
  'approach_fix_type', 'turn_direction', 'rnp', 'fix_type', 'fix_ident',
  'fix_region', 'fix_airport_ident', 'fix_lon', 'fix_lat',
  'recommended_fix_type', 'recommended_fix_ident', 'recommended_fix_region',
  'recommended_fix_lon', 'recommended_fix_lat', 'is_flyover', 'is_true_course',
  'course', 'distance_nm', 'leg_time_minutes', 'theta', 'rho', 'alt_descriptor',
  'altitude1_ft', 'altitude2_ft', 'speed_limit_type', 'speed_limit_kt',
  'vertical_angle',
];

function values(row, fields) {
  return fields.map((field) => row?.[field] ?? null);
}

function compareCanonical(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

export function navdataProcedureKey(procedure) {
  return `${procedure.airport}|${procedure.designator}|${procedure.runway_name || ''}`;
}

export function semanticProcedureSignature(procedure, transitions, legs) {
  const procedureTransitions = transitions.filter((item) => item.procedure_id === procedure.id);
  const commonLegs = legs
    .filter((item) => item.procedure_id === procedure.id && item.transition_id == null)
    .map((item) => values(item, LEG_FIELDS))
    .sort((left, right) => Number(left[1]) - Number(right[1]) || compareCanonical(left, right));

  const transitionData = procedureTransitions.map((transition) => ({
    fields: values(transition, TRANSITION_FIELDS),
    legs: legs
      .filter((item) => item.procedure_id === procedure.id && item.transition_id === transition.id)
      .map((item) => values(item, LEG_FIELDS))
      .sort((left, right) => Number(left[1]) - Number(right[1]) || compareCanonical(left, right)),
  })).sort(compareCanonical);

  return JSON.stringify({
    procedure: values(procedure, PROCEDURE_FIELDS),
    commonLegs,
    transitions: transitionData,
  });
}

export function diffNavdataProcedures(targetData, activeData) {
  const activeMap = new Map(activeData.procedures.map((procedure) => [
    navdataProcedureKey(procedure),
    semanticProcedureSignature(procedure, activeData.transitions, activeData.legs),
  ]));
  const targetKeys = new Set();
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  const procedures = targetData.procedures.map((procedure) => {
    const key = navdataProcedureKey(procedure);
    targetKeys.add(key);
    const previous = activeMap.get(key);
    const current = semanticProcedureSignature(procedure, targetData.transitions, targetData.legs);
    const diff = previous == null ? 'ADDED' : previous === current ? 'UNCHANGED' : 'CHANGED';
    if (diff === 'ADDED') added += 1;
    else if (diff === 'CHANGED') changed += 1;
    else unchanged += 1;
    return { ...procedure, diff };
  });

  const removed = activeData.procedures.filter((procedure) => !targetKeys.has(navdataProcedureKey(procedure))).length;
  return { procedures, diff: { added, changed, unchanged, removed } };
}
