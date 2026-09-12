const dms = (d, m, s) => d + m / 60 + s / 3600;

// CAAT eAIP AD 2.12: threshold coordinates and TRUE inbound bearings.
// https://aip.caat.or.th/2026-05-14-AIRAC/html/eAIP/VT-AD-2.VTBS-en-GB.html
// Reciprocal runway ends are separate thresholds (02L pairs with 20R).
// Shared by browser Final-10 detection and server Frozen / Go-around detection.
// Kept outside functions/ so Pages does not discover the type declarations as routes.
export const BANGKOK_FINAL_GEOMETRY = {
  'VTBD:21R': { lat: dms(13, 55, 34.87), lon: dms(100, 36, 44.62), course: 209 },
  'VTBD:21L': { lat: dms(13, 55, 28.33), lon: dms(100, 36, 55.97), course: 208 },
  'VTBS:19': { lat: dms(13, 41, 30.17), lon: dms(100, 45, 39.72), course: 194.42 },
  'VTBS:20L': { lat: dms(13, 42, 13.21), lon: dms(100, 44, 35.44), course: 194.42 },
  'VTBS:20R': { lat: dms(13, 42, 0.68), lon: dms(100, 44, 18.41), course: 194 },
  'VTBS:01': { lat: dms(13, 39, 24.11), lon: dms(100, 45, 6.59), course: 14.42 },
  'VTBS:02L': { lat: dms(13, 39, 54.63), lon: dms(100, 43, 45.28), course: 14 },
  'VTBS:02R': { lat: dms(13, 40, 16.60), lon: dms(100, 44, 4.79), course: 14.42 },
};
