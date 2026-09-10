// Read-only source extraction. Generated companion data never modifies the SQLite.
// Usage: node scripts/extract-regional-navdata.mjs <little_navmap_navigraph.sqlite> [--inspect]
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) throw new Error('Pass the Navigraph SQLite filename');
const db = new DatabaseSync(source, { readOnly: true });
try {
  const metadata = db.prepare('SELECT * FROM metadata LIMIT 1').get();
  if (!['NG', 'NAVIGRAPH'].includes(metadata.data_source)) throw new Error('Expected Navigraph navdata');
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  if (process.argv.includes('--inspect')) {
    console.log(JSON.stringify(all(`SELECT a.airport_ident,a.approach_id,a.type,a.suffix,a.fix_ident,a.arinc_name,a.runway_name,
      group_concat(l.type) paths FROM approach a JOIN approach_leg l ON l.approach_id=a.approach_id AND l.is_missed=0
      WHERE a.airport_ident IN ('VTCC','VTSP') AND coalesce(a.suffix,'') NOT IN ('A','D') GROUP BY a.approach_id`), null, 2));
  } else {
    const leg = (row) => ({
      path: row.type, fix: row.fix_ident, lat: row.fix_laty, lon: row.fix_lonx,
      course: row.course, distanceNm: row.distance, turn: row.turn_direction,
      altitudeType: row.alt_descriptor, altitude1Ft: row.altitude1, altitude2Ft: row.altitude2,
      speedType: row.speed_limit_type, speedKt: row.speed_limit,
    });
    const airports = {};
    for (const code of ['VTCC', 'VTSP']) {
      const airport = db.prepare('SELECT * FROM airport WHERE ident=?').get(code);
      if (!airport) throw new Error(`Airport missing: ${code}`);
      const runways = all(`SELECT e.* FROM runway r JOIN runway_end e ON e.runway_end_id IN (r.primary_end_id,r.secondary_end_id)
        WHERE r.airport_id=? ORDER BY e.name`, airport.airport_id).map((r) => ({
        name: r.name, lat: r.laty, lon: r.lonx, elevationFt: r.altitude, course: r.heading,
        displacedThresholdFt: r.offset_threshold,
      }));
      const procedures = all(`SELECT * FROM approach WHERE airport_id=? AND coalesce(suffix,'') != 'D'
        ORDER BY approach_id`, airport.airport_id).map((p) => ({
        // VOR-A is an approach, not a STAR. Little Navmap encodes STAR as GPS/A.
        id: String(p.approach_id), kind: p.suffix === 'A' && p.type === 'GPS' ? 'STAR' : 'APPROACH',
        name: p.suffix === 'A' && p.type === 'GPS' ? p.fix_ident : (p.arinc_name || `${p.type}${p.runway_name}${p.suffix || ''}`),
        type: p.type, runway: p.runway_name,
        legs: all('SELECT * FROM approach_leg WHERE approach_id=? AND is_missed=0 ORDER BY approach_leg_id', p.approach_id).map(leg),
        transitions: all('SELECT * FROM transition WHERE approach_id=? ORDER BY transition_id', p.approach_id).map((t) => ({
          name: t.fix_ident, legs: all('SELECT * FROM transition_leg WHERE transition_id=? ORDER BY transition_leg_id', t.transition_id).map(leg),
        })),
      }));
      airports[code] = { code, name: airport.name, lat: airport.laty, lon: airport.lonx,
        elevationFt: airport.altitude, runways, procedures };
    }
    const output = { cycle: metadata.airac_cycle, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
      source: 'LITTLE_NAVMAP_NAVIGRAPH', airports };
    const directory = fileURLToPath(new URL('../functions/_data/', import.meta.url));
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/regional-arrivals.json`, `${JSON.stringify(output)}\n`);
    console.log(`Extracted AIRAC ${output.cycle}: ${Object.entries(airports).map(([code,a]) => `${code} ${a.procedures.length} procedures`).join(', ')}`);
  }
} finally { db.close(); }
