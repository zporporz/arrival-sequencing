// A planning choice is never an ATC clearance. Both runtimes use this policy.
export function supportsArrivalRunway(published, selected) {
  if (!/^\d{2}[LRC]?$/.test(selected) || Number(selected.slice(0, 2)) < 1 || Number(selected.slice(0, 2)) > 36) return false;
  return published === selected || (/^\d{2}B$/.test(published)
    && published.slice(0, 2) === selected?.slice(0, 2) && /[LR]$/.test(selected));
}

export function chooseArrivalStar({ airport, runway, entryFix, filed = null, candidates, selected, cycle }) {
  const compatible = candidates.filter(p => p.airport === airport && p.entryFix === entryFix
    && p.runways.some(r => supportsArrivalRunway(r, runway)));
  const choices = [...new Map(compatible.map(p => [p.name, p])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const picked = selected ? choices.find(p => p.name === selected) : choices.length === 1 ? choices[0] : null;
  const status = picked ? selected ? 'MANUAL_ESTIMATE' : 'ESTIMATED' : 'REQUIRED';
  return { status, airport, runway, entryFix, filed, selected: picked?.name || null, cycle,
    candidates: choices.map(p => p.name),
    reason: `${filed ? `FPL STAR ${filed} / RWY ${runway} MISMATCH · ` : ''}${picked
      ? `STAR EST ${picked.name} · ${selected ? 'LOCAL USER CHOICE' : 'UNIQUE COMPATIBLE STAR'} · NOT A CLEARANCE`
      : `SELECT STAR · ${selected ? 'Previous choice is no longer compatible' : choices.length ? 'Multiple compatible STARs' : 'No verified compatible STAR'}`}` };
}
