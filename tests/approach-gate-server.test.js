import { beforeEach, describe, expect, it, vi } from 'vitest';
import data from '../functions/_data/final-approaches.json';
import { onRequestPost } from '../functions/api/sequence/aman-state.js';
import { onRequestGet } from '../functions/api/sequence/final-approaches.js';
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js';
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }));

const cycle = { cycle: data.cycle, source_sha256: data.sourceSha256 };
function existing(change = {}) {
  return { airport: 'VTBD', callsign: 'TEST1', service_date: '2026-09-12', revision: 8,
    frozen_tldt: null, snapshot: { latitude: 13.766583335, longitude: 100.565218055, heading: 331.6,
      altitude: 2500, onGround: false, state: 'approach', trackTimestamp: new Date().toISOString() }, ...change };
}
function post(change = {}) {
  return onRequestPost({ env: {}, data: { auth: { vid: '1', name: 'Test' } }, request: new Request('https://test/api/sequence/aman-state', {
    method: 'POST', body: JSON.stringify({ action: 'setFrozenTarget', airport: 'VTBD', callsign: 'TEST1', runway: '03L',
      approachCategory: 'C', approachPath: true, approachName: '', approachCycle: data.cycle, distanceNm: 0,
      trackAt: new Date().toISOString(), pathDistanceNm: 0, ...change }),
  }) });
}
beforeEach(() => vi.resetAllMocks());

describe('canonical Frozen approach capture', () => {
  it('calculates from the trusted snapshot and stores the remaining path, ignoring supplied distances', async () => {
    const row = existing();
    supabaseAdminRequest.mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ data: [cycle] })
      .mockImplementationOnce(async (_, path, options) => {
        expect(path).toContain('frozen_tldt=is.null');
        return { data: [{ ...row, ...JSON.parse(options.body) }] };
      });
    const result = await post();
    expect(result.status).toBe(200);
    const saved = (await result.json()).flightState;
    expect(saved.frozen_distance_nm).toBeCloseTo(8.03, 2);
    expect(saved.frozen_path_distance_nm).toBeCloseTo(8.91, 2);
    expect(saved.frozen_approach_path).toContain('2609:I03LZ/DOTLI');
    expect(Date.parse(saved.frozen_tldt) - Date.parse(row.snapshot.trackTimestamp)).toBeGreaterThan(220000);
    expect(saved.frozen_track_at).toBe(row.snapshot.trackTimestamp);
  });
  it.each([
    ['wrong cycle', { ...cycle, cycle: '2610' }, existing()],
    ['wrong SQLite', { ...cycle, source_sha256: 'wrong' }, existing()],
    ['no snapshot', cycle, existing({ snapshot: null })],
    ['off route', cycle, existing({ snapshot: { ...existing().snapshot, longitude: 100.1 } })],
    ['stale track', cycle, existing({ snapshot: { ...existing().snapshot, trackTimestamp: '2020-01-01T00:00:00Z' } })],
    ['ground', cycle, existing({ snapshot: { ...existing().snapshot, onGround: true } })],
  ])('does not write a capture with %s', async (_, active, row) => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ data: [active] });
    expect((await post()).status).toBe(400);
    expect(supabaseAdminRequest.mock.calls.every(c => !c[2]?.method)).toBe(true);
  });
  it('does not refreeze during an active GA', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [existing({ missed_approach_active: true })] });
    expect((await post()).status).toBe(400);
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1);
  });
  it('returns the same-runway canonical target to late joiners without recalculating it', async () => {
    const row = existing({ frozen_tldt: '2026-09-12T10:04:00Z', frozen_runway: '03L' });
    supabaseAdminRequest.mockResolvedValueOnce({ data: [row] });
    expect((await (await post()).json()).flightState).toEqual(row);
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1);
  });
  it('returns the winning capture when two controllers detect the approach together', async () => {
    const row = existing(), winner = { ...row, frozen_tldt: new Date().toISOString(), frozen_runway: '03L' };
    supabaseAdminRequest.mockResolvedValueOnce({ data: [row] }).mockResolvedValueOnce({ data: [cycle] })
      .mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [winner] });
    expect((await (await post()).json()).flightState).toEqual(winner);
  });
  it.each([['VTCC', '36', '18'], ['VTSP', '27', '09']])('recaptures %s after a runway change as it does at Bangkok', async (airport, oldRunway, runway) => {
    const row = existing({ airport, frozen_tldt: '2026-09-12T10:04:00Z', frozen_runway: oldRunway });
    supabaseAdminRequest.mockResolvedValueOnce({ data: [row] }).mockImplementationOnce(async (_, path, options) => {
      expect(path).toContain('revision=eq.8');
      return { data: [{ ...row, ...JSON.parse(options.body) }] };
    });
    const result = await post({ airport, runway, approachPath: false, distanceNm: 5 });
    expect(result.status).toBe(200);
    expect((await result.json()).flightState.frozen_runway).toBe(runway);
  });
});

describe('authenticated approach package handler', () => {
  it.each(['VTBD', 'VTBS', 'VTCC', 'VTSP'])('serves only verified active %s data', async airport => {
    supabaseAdminRequest.mockResolvedValue({ data: [cycle] });
    const response = await onRequestGet({ env: {}, request: new Request(`https://test/api/sequence/final-approaches?airport=${airport}`) });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).airport.code).toBe(airport);
  });
  it('fails closed on mismatched AIRAC', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ ...cycle, cycle: '2610' }] });
    expect((await onRequestGet({ env: {}, request: new Request('https://test/api/sequence/final-approaches?airport=VTBD') })).status).toBe(503);
  });
});
