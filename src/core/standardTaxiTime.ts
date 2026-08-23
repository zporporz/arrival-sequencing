// AMNAC SID V5.0 (effective 14 Jul 2026), STT table last updated 30 Jun 2026.
// Values are minutes and apply to the DEPARTURE aerodrome.

const EXPLICIT_STT_MINUTES: Record<string, number> = {
  // Thailand
  VTBD: 15, VTBS: 20, VTBU: 8, VTCC: 10, VTCT: 9, VTSB: 6, VTSG: 12, VTSM: 8, VTSP: 18, VTSS: 10,
  VTBK: 5, VTBL: 5, VTBO: 5, VTBP: 10, VTCH: 8, VTCL: 5, VTCN: 6, VTCP: 6, VTPB: 9, VTPH: 12,
  VTPI: 10, VTPM: 7, VTPN: 5, VTPO: 5, VTPP: 5, VTPT: 5, VTSC: 6, VTSE: 8, VTSF: 8, VTSH: 5,
  VTSK: 15, VTSN: 5, VTSR: 6, VTST: 8, VTUD: 8, VTUI: 8, VTUK: 8, VTUL: 6, VTUN: 12, VTUO: 10,
  VTUQ: 15, VTUU: 12, VTUV: 15, VTUW: 15,

  // China
  ZGGG: 20, ZGSZ: 20, ZJHK: 15, ZJSY: 15, ZSPD: 20, ZSSS: 20, ZBAA: 20, ZBAD: 20,

  // Singapore / Hong Kong China / Macau
  WSSS: 20, VHHH: 25, VMMC: 15,

  // Cambodia
  VDTI: 10, VDSA: 10, VDSV: 5,

  // Republic of Korea
  RKSI: 25, RKSS: 25, RKPC: 15, RKTN: 15, RKPK: 15, RKNW: 15,

  // Indonesia
  WIII: 16, WADD: 15, WARR: 16,

  // Malaysia
  WBGG: 10, WBKK: 12, WMKI: 10, WMKJ: 10, WMKL: 9, WMKP: 12, WMSA: 6, WMKK: 25,

  // Philippines
  RPLL: 12, RPLC: 12, RPVM: 10, RPSP: 10,

  // Viet Nam
  VVTS: 15, VVNB: 15, VVDN: 9, VVCI: 12, VVCR: 9, VVPQ: 6, VVVD: 15, VVVH: 10, VVPB: 10, VVCT: 10, VVDL: 6,
}

export function standardTaxiOutMinutes(airport: string | null | undefined) {
  const icao = String(airport || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4}$/.test(icao)) return null

  const explicit = EXPLICIT_STT_MINUTES[icao]
  if (Number.isFinite(explicit)) return explicit

  // National defaults explicitly stated by the AMNAC STT table.
  if (icao.startsWith('Z')) return 15
  if (icao.startsWith('RK')) return 10

  // AMNAC SID: use 20 minutes for other airports in member States not specified.
  if (
    icao.startsWith('VT') || icao.startsWith('WS') || icao.startsWith('VH') ||
    icao.startsWith('VD') || icao.startsWith('WA') || icao.startsWith('WI') ||
    icao.startsWith('WR') || icao.startsWith('WB') || icao.startsWith('WM') ||
    icao.startsWith('RP') || icao.startsWith('VY') || icao.startsWith('VV') ||
    icao.startsWith('VL') || icao.startsWith('RJ')
  ) return 20

  return null
}
