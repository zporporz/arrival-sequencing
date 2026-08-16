export type ArrivalStatus = 'INBOUND' | 'SEQUENCED' | 'LANDING' | 'LANDED' | 'CANCELLED'

export type SequenceSession = {
  id: string
  airport: string
  flow: string
  runway_config: string | null
  service_date: string
  status: 'ACTIVE' | 'CLOSED'
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FixTiming = {
  id: number
  airport: string
  flow: string
  fix: string
  nominal_seconds: number
  source: string
  verified: boolean
  effective_from: string
  effective_to: string | null
  active: boolean
}

export type ArrivalView = {
  id: string
  session_id: string
  airport: string
  flow: string
  runway_config: string | null
  service_date: string
  sequence_no: number
  callsign: string
  aircraft_type: string | null
  departure: string | null
  ref_fix: string
  eto: string
  nominal_seconds_snapshot: number
  eldt: string
  cldt: string
  cto: string
  aldt: string | null
  est_var: string | null
  seq_var: string | null
  status: ArrivalStatus
  note: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}
