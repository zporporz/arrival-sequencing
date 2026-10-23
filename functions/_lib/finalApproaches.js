import { activeAiracAirport } from './activeAiracAirports.js';
import { landingThreshold } from './regionalGeometry.js';

export async function activeFinalApproaches(env, code) {
  const { cycle, airport } = await activeAiracAirport(env, code);
  return { cycle, airport, thresholds: Object.fromEntries(airport.runways.map(r =>
    [r.name, landingThreshold(r)])) };
}
