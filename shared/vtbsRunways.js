// Shared browser/server data, outside Pages Functions route discovery.
export const VTBS_RUNWAY_GROUPS = {
  '19_20': ['19', '20L', '20R'],
  '01_02': ['01', '02L', '02R'],
};
export const VTBS_ALL_RUNWAYS = Object.values(VTBS_RUNWAY_GROUPS).flat();

// Old workspaces have no explicit flow. Infer it from their runway keys,
// including an all-CLOSED custom configuration, without enabling both ends.
export function vtbsFlowFromWorkspace(modes = {}, settings = {}) {
  if (settings.runwayFlow === '01_02' || settings.runwayFlow === '19_20') return settings.runwayFlow;
  const north = VTBS_RUNWAY_GROUPS['01_02'];
  const south = VTBS_RUNWAY_GROUPS['19_20'];
  if (north.some(r => modes[r] && modes[r] !== 'CLOSED')) return '01_02';
  if (north.some(r => r in modes) && !south.some(r => r in modes)) return '01_02';
  return '19_20';
}

export function vtbsModesForFlow(modes, flow) {
  const active = VTBS_RUNWAY_GROUPS[flow];
  return Object.fromEntries(VTBS_ALL_RUNWAYS.map(runway => [runway,
    active.includes(runway) && ['ARR', 'DEP', 'MIX', 'CLOSED'].includes(modes[runway]) ? modes[runway] : 'CLOSED',
  ]));
}
