import { describe, expect, it } from 'vitest'
import { diffNavdataProcedures } from '../functions/_lib/navdataDiff.js'

function cycle(ids, altitude = 7000) {
  return {
    procedures: [{
      id: ids.procedure,
      cycle_id: ids.cycle,
      source_approach_id: ids.sourceApproach,
      airport: 'VTBD',
      designator: 'NAKO3A',
      runway_name: 'RW21B',
      arinc_name: 'NAKO3A',
      source_type: 'GPS',
      source_suffix: 'A',
      aircraft_category: null,
      fingerprint: ids.fingerprint,
    }],
    transitions: [{
      id: ids.transition,
      cycle_id: ids.cycle,
      procedure_id: ids.procedure,
      source_transition_id: ids.sourceTransition,
      ident: 'NAKON',
      source_type: 'RNAV',
      aircraft_category: null,
    }],
    legs: [{
      id: ids.leg,
      cycle_id: ids.cycle,
      procedure_id: ids.procedure,
      transition_id: ids.transition,
      source_leg_id: ids.sourceLeg,
      leg_kind: 'TRANSITION',
      leg_order: 1,
      path_terminator: 'IF',
      fix_ident: 'NAKON',
      altitude1_ft: altitude,
      is_flyover: false,
      is_true_course: false,
    }],
  }
}

describe('AIRAC semantic diff', () => {
  const active = cycle({ cycle: '2608', procedure: 10, sourceApproach: 100, transition: 20, sourceTransition: 200, leg: 30, sourceLeg: 300, fingerprint: 'old' })

  it('ignores database IDs, source IDs and legacy fingerprints', () => {
    const target = cycle({ cycle: '2609', procedure: 110, sourceApproach: 1100, transition: 120, sourceTransition: 1200, leg: 130, sourceLeg: 1300, fingerprint: 'new' })
    expect(diffNavdataProcedures(target, active).diff).toEqual({ added: 0, changed: 0, unchanged: 1, removed: 0 })
  })

  it('still detects an operational leg constraint change', () => {
    const target = cycle({ cycle: '2609', procedure: 110, sourceApproach: 1100, transition: 120, sourceTransition: 1200, leg: 130, sourceLeg: 1300, fingerprint: 'new' }, 8000)
    expect(diffNavdataProcedures(target, active).diff).toEqual({ added: 0, changed: 1, unchanged: 0, removed: 0 })
  })

  it('reports renamed procedures as one addition and one removal', () => {
    const target = cycle({ cycle: '2609', procedure: 110, sourceApproach: 1100, transition: 120, sourceTransition: 1200, leg: 130, sourceLeg: 1300, fingerprint: 'new' })
    target.procedures[0].designator = 'NAKO4A'
    expect(diffNavdataProcedures(target, active).diff).toEqual({ added: 1, changed: 0, unchanged: 0, removed: 1 })
  })
})
