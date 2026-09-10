// Little Navmap runway ends are physical ends. Shift to the landing threshold.
export function landingThreshold(runway) {
  const course = runway.course * Math.PI / 180;
  const arc = Math.max(0, runway.displacedThresholdFt || 0) / 6076.12 / 3440.065;
  const lat = runway.lat * Math.PI / 180, lon = runway.lon * Math.PI / 180;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(course));
  const nextLon = lon + Math.atan2(Math.sin(course) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(nextLat));
  return { lat: nextLat * 180 / Math.PI, lon: nextLon * 180 / Math.PI, course: runway.course };
}

export function regionalFinalGeometry(airport) {
  return Object.fromEntries(airport.runways.map(runway => [`${airport.code}:${runway.name}`, landingThreshold(runway)]));
}
