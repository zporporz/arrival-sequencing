// Shared browser/server data; keep outside Pages Functions route discovery.
export const VTBD_RUNWAY_GROUPS = {
  '21': ['21R', '21L'],
  '03': ['03L', '03R'],
};
export const VTBD_ALL_RUNWAYS = Object.values(VTBD_RUNWAY_GROUPS).flat();

export function vtbdFlowFromWorkspace(modes = {}, settings = {}) {
  if (settings.runwayFlow === '03' || settings.runwayFlow === '21') return settings.runwayFlow;
  const north = VTBD_RUNWAY_GROUPS['03'], south = VTBD_RUNWAY_GROUPS['21'];
  if (north.some(r => modes[r] && modes[r] !== 'CLOSED')) return '03';
  if (north.some(r => r in modes) && !south.some(r => r in modes)) return '03';
  return '21';
}

export function vtbdModesForFlow(modes, flow) {
  return Object.fromEntries(VTBD_ALL_RUNWAYS.map(runway => [runway,
    VTBD_RUNWAY_GROUPS[flow].includes(runway) && ['ARR', 'DEP', 'MIX', 'CLOSED'].includes(modes[runway])
      ? modes[runway] : 'CLOSED',
  ]));
}
