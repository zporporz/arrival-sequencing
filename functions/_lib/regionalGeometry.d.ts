type Runway = { name: string; lat: number; lon: number; course: number; displacedThresholdFt?: number }
export function landingThreshold(runway: Runway): { lat: number; lon: number; course: number }
export function regionalFinalGeometry(airport: { code: string; runways: Runway[] }): Record<string, { lat: number; lon: number; course: number }>
