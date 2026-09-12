import type { NavProcedure } from '../src/core/regionalArrivalModel'
export type ApproachAirport = { code: string; elevationFt: number; procedures: NavProcedure[] }
export type ApproachTrack = { latitude: number | null; longitude: number | null; heading: number | null;
  altitude?: number | null; verticalSpeedFpm?: number | null; state?: string; onGround: boolean | null; trackTimestamp: string | null }
type Point = { lat: number; lon: number }
export type ApproachGateMatch = { directNm: number; remainingNm: number; cross: number; approachName: string; pathName: string }
export function approachDistance(a: Point, b: Point): number
export function buildApproachPaths(airport: ApproachAirport, runway: string, threshold: Point, approachName?: string):
  { name: string; approachName: string; segments: { start: Point; end: Point; distanceNm: number; course: number }[] }[]
export function evaluateApproachGate(airport: ApproachAirport, runway: string, threshold: Point, flight: ApproachTrack,
  nowMs?: number, approachName?: string): ApproachGateMatch | null
