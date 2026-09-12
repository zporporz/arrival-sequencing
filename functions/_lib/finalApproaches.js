import data from '../_data/final-approaches.json';
import { supabaseAdminRequest } from './supabaseAdmin.js';
import { landingThreshold } from './regionalGeometry.js';
import { BANGKOK_FINAL_GEOMETRY } from '../../shared/bangkokFinalGeometry.js';

export async function activeFinalApproaches(env, code) {
  const airport = data.airports[code];
  if (!airport) throw new Error('Unsupported approach airport');
  const { data: cycles } = await supabaseAdminRequest(env,
    'navdata_cycles?status=eq.ACTIVE&select=cycle,source_sha256&limit=1');
  const active = cycles?.[0];
  if (!active || active.cycle !== data.cycle || active.source_sha256 !== data.sourceSha256) {
    throw new Error('Final approach package does not match active AIRAC');
  }
  return { cycle: data.cycle, airport, thresholds: Object.fromEntries(airport.runways.map(r =>
    [r.name, BANGKOK_FINAL_GEOMETRY[`${code}:${r.name}`] || landingThreshold(r)])) };
}
