import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }));
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js';
import { c172PlanningEstimate, getSimbriefAircraftPerformance } from '../functions/_lib/simbriefPerformance.js';
import { calculateRegionalTiming } from '../src/core/regionalArrivalModel';
import regional from '../functions/_data/regional-arrivals.json';
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('C208 uses C172 planning performance when a numeric profile is unavailable', () => {
  it('uses identical planning speeds/category but retains C208 identity and estimate provenance', () => {
    const { aircraftType, aircraftName, ...c208 } = c172PlanningEstimate('C208');
    const { aircraftType: _, aircraftName: __, ...c172 } = c172PlanningEstimate('C172');
    expect(aircraftType).toBe('C208');
    expect(c208).toEqual(c172);
    expect(c208.source).toBe('LOCAL_ESTIMATE');
    expect(c172PlanningEstimate('A320')).toBeNull();
  });
  it('returns the explicit estimate when database/upstream data cannot be used, without saving it as SimBrief', async () => {
    supabaseAdminRequest.mockRejectedValue(new Error('unavailable'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ C208: { aircraft_profiles_descent: ['800FPM'] } }));
    const profile = await getSimbriefAircraftPerformance({}, 'C208');
    expect(profile).toMatchObject({ aircraftType: 'C208', source: 'LOCAL_ESTIMATE', performanceCategory: 'A' });
    expect(supabaseAdminRequest.mock.calls.every(c => !c[2]?.method)).toBe(true);
  });
  it('preserves a usable real numeric C208 profile instead of replacing it', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ aircraft_type: 'C208', performance_category: 'A',
      descent_profile: '40/180/160', descent_mach: .4, descent_ias_kt: 180, descent_below_10000_ias_kt: 160,
      last_checked_at: new Date().toISOString() }] });
    expect(await getSimbriefAircraftPerformance({}, 'C208')).toMatchObject({ source: 'SIMBRIEF', descentIasKt: 180 });
  });
  it('produces the same regional timing as C172 on a connected VTCC approach', () => {
    const a = regional.airports.VTCC;
    const star = a.procedures.find(p => p.kind === 'STAR' && p.runway === '36');
    const approach = a.procedures.find(p => p.name === 'I36-Z');
    const c172 = calculateRegionalTiming(a, star, approach, c172PlanningEstimate('C172'));
    const c208 = calculateRegionalTiming(a, star, approach, c172PlanningEstimate('C208'));
    expect(c172.error).toBeUndefined();
    expect(c208.timing.nominalSeconds).toBeGreaterThan(0);
    expect(c208).toEqual(c172);
  });
});
