// Geometric EST only, not evidence of an ATC clearance. Unsupported leg types are
// never replaced by a direct shortcut. Shared by browser detection and server capture.
const rad = n => n * Math.PI / 180;
const delta = (a, b) => ((a - b + 540) % 360) - 180;
const validPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
export function approachDistance(a, b) {
  const v = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6880.13 * Math.asin(Math.sqrt(Math.min(1, v)));
}
function course(a, b) {
  const x = rad(b.lon - a.lon);
  return (Math.atan2(Math.sin(x) * Math.cos(rad(b.lat)), Math.cos(rad(a.lat)) * Math.sin(rad(b.lat))
    - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(x)) * 180 / Math.PI + 360) % 360;
}

export function buildApproachPaths(airport, runway, threshold, approachName = '') {
  if (!airport || !validPoint(threshold)) return [];
  const paths = [];
  for (const p of airport.procedures || []) {
    if (p.kind !== 'APPROACH' || p.runway !== runway || (approachName && p.name !== approachName)) continue;
    for (const t of [null, ...(p.transitions || [])]) {
      const common = p.legs || [];
      const transition = t?.legs || [];
      // No invented connector from the end of a transition to an unrelated IF.
      if (t && (!transition.length || !common.length || !validPoint(transition.at(-1))
        || !validPoint(common[0]) || approachDistance(transition.at(-1), common[0]) > 0.02)) continue;
      const legs = [...transition, ...common];
      if (legs.length < 2 || legs[0].path !== 'IF'
        || legs.some(l => !validPoint(l) || !['IF', 'TF', 'CF'].includes(l.path))) continue;
      const points = [];
      let disconnected = false;
      for (const l of legs) {
        const previous = points.at(-1);
        if (previous && approachDistance(previous, l) < 0.02) continue;
        if (previous && l.path === 'IF') { disconnected = true; break; }
        points.push(l);
      }
      // VOR/MAP procedures ending short of the runway are not extended by guesswork.
      if (disconnected || points.length < 2 || approachDistance(points.at(-1), threshold) > 0.25) continue;
      points[points.length - 1] = { ...points.at(-1), ...threshold };
      const segments = points.slice(1).map((end, i) => ({
        start: points[i], end, distanceNm: approachDistance(points[i], end), course: course(points[i], end),
      }));
      paths.push({ name: `${p.name}${t ? '/' + t.name : ''}`, approachName: p.name, segments });
    }
  }
  return paths;
}

export function evaluateApproachGate(airport, runway, threshold, flight, nowMs = Date.now(), approachName = '') {
  const position = { lat: flight?.latitude, lon: flight?.longitude };
  const age = nowMs - Date.parse(flight?.trackTimestamp || '');
  const height = flight?.altitude - airport?.elevationFt;
  if (!validPoint(position) || !validPoint(threshold) || flight?.onGround !== false
    || !Number.isFinite(flight.heading) || !Number.isFinite(age) || age < -30000 || age > 90000
    || !Number.isFinite(flight.altitude) || height <= 0 || height > 6000
    || (Number.isFinite(flight.verticalSpeedFpm) && flight.verticalSpeedFpm > 600)
    || /^(initial climb|departing|landed|on blocks)$/i.test(flight.state || '')) return null;
  const directNm = approachDistance(position, threshold);
  if (directNm > 10 || directNm < 0.1) return null;
  const matches = [];
  for (const path of buildApproachPaths(airport, runway, threshold, approachName)) {
    const candidates = [];
    path.segments.forEach((s, i) => {
      const toPosition = approachDistance(s.start, position);
      const offset = rad(delta(course(s.start, position), s.course));
      const along = toPosition * Math.cos(offset);
      const cross = Math.abs(toPosition * Math.sin(offset));
      if (along < 0 || along > s.distanceNm || cross > 0.8) return;
      // Normal segment heading plus a bounded fly-by corner envelope. No global
      // relaxation of runway alignment for arbitrary aircraft within the radius.
      let headingOk = Math.abs(delta(flight.heading, s.course)) <= 45;
      for (const [neighbor, corner] of [[path.segments[i - 1], s.start], [path.segments[i + 1], s.end]]) {
        if (!neighbor || approachDistance(position, corner) > 1) continue;
        const turn = delta(neighbor.course, s.course);
        const h = delta(flight.heading, s.course);
        if (Math.abs(turn) <= 120 && h >= Math.min(0, turn) - 15 && h <= Math.max(0, turn) + 15) headingOk = true;
      }
      const publishedAlt = Math.max(s.start.altitude1Ft || 0, s.start.altitude2Ft || 0,
        s.end.altitude1Ft || 0, s.end.altitude2Ft || 0);
      if (!headingOk || (publishedAlt > 0 && flight.altitude > publishedAlt + 1500)) return;
      // Retain every downstream bend. Off-centre fly-by position goes to this leg's
      // end, rather than projecting it onto a later leg and skipping the IF turn.
      const remainingNm = approachDistance(position, s.end)
        + path.segments.slice(i + 1).reduce((total, next) => total + next.distanceNm, 0);
      if (remainingNm >= directNm - 0.02 && remainingNm <= 30) candidates.push({ remainingNm, cross });
    });
    if (candidates.length) {
      const best = candidates.sort((a, b) => b.remainingNm - a.remainingNm)[0];
      matches.push({ ...best, directNm, approachName: path.approachName, pathName: path.name });
    }
  }
  if (!matches.length) return null;
  // Coincident ILS/RNAV legs are equivalent; materially different remaining paths
  // require an explicit approach selection instead of silently choosing a shortcut.
  matches.sort((a, b) => b.remainingNm - a.remainingNm || a.pathName.localeCompare(b.pathName));
  if (matches[0].remainingNm - matches.at(-1).remainingNm > 1) return null;
  return matches[0];
}
