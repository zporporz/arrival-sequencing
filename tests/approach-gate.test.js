import { describe, expect, it } from 'vitest';
import data from '../functions/_data/final-approaches.json';
import regional from '../functions/_data/regional-arrivals.json';
import { approachDistance, buildApproachPaths, evaluateApproachGate } from '../shared/approachGate.js';
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry.js';
import { landingThreshold } from '../functions/_lib/regionalGeometry.js';
import { frozenTargetForApproachCategory } from '../functions/api/sequence/aman-state.js';

const now = Date.parse('2026-09-12T10:00:00Z');
const track = { latitude: 10.15, longitude: 100.04, heading: 270, altitude: 2500, onGround: false,
  state: 'approach', verticalSpeedFpm: -500, trackTimestamp: new Date(now).toISOString() };
const threshold = { lat: 10, lon: 100 };
const leg = (fix, lat, lon, path = 'TF') => ({ fix, lat, lon, path, altitude1Ft: 2500 });
const airport = { code: 'TEST', elevationFt: 0, procedures: [{ kind: 'APPROACH', name: 'R18', runway: '18',
  legs: [leg('IAF', 10.15, 100.08, 'IF'), leg('IF', 10.15, 100), leg('RW18', 10, 100)], transitions: [] }] };

describe('published approach 10 NM gate', () => {
  it('freezes during the IF turn and retains the bend even when path distance exceeds 10 NM', () => {
    const m = evaluateApproachGate(airport, '18', threshold, track, now);
    expect(m.directNm).toBeLessThan(10);
    expect(m.remainingNm).toBeGreaterThan(11);
    const target = frozenTargetForApproachCategory({ approachCategory: 'C', distanceNm: m.directNm, trackAt: track.trackTimestamp }, m.remainingNm);
    expect(Date.parse(target.frozenTldt) - now).toBeCloseTo(Math.floor(m.remainingNm / 140 * 3600000), 0);
    expect(Date.parse(target.frozenTldt) - now).toBeGreaterThan(m.directNm / 140 * 3600000);
  });
  it.each([
    { onGround: true }, { onGround: null }, { latitude: null }, { altitude: null }, { heading: null },
    { altitude: 33000 }, { altitude: -10 }, { heading: 90 }, { verticalSpeedFpm: 1200 },
    { state: 'initial climb' }, { state: 'departing' }, { trackTimestamp: new Date(now - 91000).toISOString() },
    { trackTimestamp: new Date(now + 31000).toISOString() }, { longitude: 100.5 }, { latitude: 10.12 },
  ])('does not accept an unsafe/non-approach sample: %j', change => {
    expect(evaluateApproachGate(airport, '18', threshold, { ...track, ...change }, now)).toBeNull();
  });
  it('requires the assigned runway and selected approach, not just a nearby path', () => {
    expect(evaluateApproachGate(airport, '36', threshold, track, now)).toBeNull();
    expect(evaluateApproachGate(airport, '18', threshold, track, now, 'I18')).toBeNull();
  });
  it('accepts headings through a fly-by corner without accepting a turn away', () => {
    const turning = { ...track, longitude: 100.005, latitude: 10.145, heading: 225 };
    expect(evaluateApproachGate(airport, '18', threshold, turning, now)).not.toBeNull();
    expect(evaluateApproachGate(airport, '18', threshold, { ...turning, heading: 45 }, now)).toBeNull();
  });
  it.each(['RF', 'AF', 'VM', 'FM', 'HF', 'PI', 'IF'])('does not bridge unsupported/disconnected %s legs', path => {
    const copy = structuredClone(airport);
    copy.procedures[0].legs[1].path = path;
    expect(buildApproachPaths(copy, '18', threshold)).toEqual([]);
  });
  it('does not extend a short MAP to the runway or bridge a detached transition', () => {
    const copy = structuredClone(airport);
    copy.procedures[0].legs.at(-1).lat += 0.02;
    expect(buildApproachPaths(copy, '18', threshold)).toEqual([]);
    copy.procedures[0] = { ...airport.procedures[0], transitions: [{ name: 'BAD', legs: [leg('BAD', 11, 100, 'IF')] }] };
    expect(buildApproachPaths(copy, '18', threshold).map(p => p.name)).toEqual(['R18']);
  });
  it('does not choose between materially different overlapping approaches', () => {
    const copy = structuredClone(airport);
    copy.procedures.push({ ...structuredClone(airport.procedures[0]), name: 'DETOUR' });
    copy.procedures[1].legs.splice(2, 0, leg('BEND', 10.12, 99.9));
    expect(evaluateApproachGate(copy, '18', threshold, track, now)).toBeNull();
    expect(evaluateApproachGate(copy, '18', threshold, track, now, 'R18')).not.toBeNull();
  });
});

describe('active navdata coverage', () => {
  it('uses the same SQLite source as regional timings without adding STAR/SID/missed legs', () => {
    expect(data.cycle).toBe(regional.cycle);
    expect(data.sourceSha256).toBe(regional.sourceSha256);
    for (const a of Object.values(data.airports)) expect(a.procedures.every(p => p.kind === 'APPROACH')).toBe(true);
  });
  const runways = Object.values(data.airports).flatMap(a => a.runways.map(r => [a.code, r.name]));
  it.each(runways)('supports a threshold-connected approach for %s %s', (code, runway) => {
    const a = data.airports[code], r = a.runways.find(r => r.name === runway);
    const th = BANGKOK_FINAL_GEOMETRY[`${code}:${runway}`] || landingThreshold(r);
    const paths = buildApproachPaths(a, runway, th);
    expect(paths.length).toBeGreaterThan(0);
    const s = paths[0].segments.at(-1);
    const f = { ...track, latitude: (s.start.lat + th.lat) / 2, longitude: (s.start.lon + th.lon) / 2,
      heading: s.course, altitude: Math.max(1000 + a.elevationFt, s.start.altitude1Ft || 0) };
    expect(evaluateApproachGate(a, runway, th, f, now)).not.toBeNull();
  });
  it('recognizes the real DOTLI-to-LURPO turn at VTBD 03L, despite not facing the runway yet', () => {
    const f = { ...track, latitude: 13.766583335, longitude: 100.565218055, heading: 331.6 };
    const m = evaluateApproachGate(data.airports.VTBD, '03L', BANGKOK_FINAL_GEOMETRY['VTBD:03L'], f, now);
    expect(m.pathName).toContain('DOTLI');
    expect(m.remainingNm - m.directNm).toBeGreaterThan(0.8);
  });
  it('uses radial distance, not projected runway distance, at the 10 NM boundary', () => {
    const f = { ...track, latitude: 10.15, longitude: 100.075 };
    expect(approachDistance({ lat: f.latitude, lon: f.longitude }, threshold)).toBeGreaterThan(10);
    expect(evaluateApproachGate(airport, '18', threshold, f, now)).toBeNull();
  });
});
