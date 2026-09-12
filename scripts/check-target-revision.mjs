// Isolated PostgreSQL/WASM check; never connects to Supabase.
// npm install --prefix tmp/target-revision-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
// node scripts/check-target-revision.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../tmp/target-revision-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
try {
  await db.exec(`create table public.aman_flight_states (
    callsign text primary key, canonical_session_id text, target_mode text default 'AUTO',
    manual_tldt timestamptz, manual_runway text, manual_updated_at timestamptz,
    auto_return_tldt timestamptz, auto_return_floor_tldt timestamptz, auto_return_runway text, auto_returned_at timestamptz,
    operational_state text default 'NORMAL', operational_updated_at timestamptz, reserved_gap_seconds integer default 0,
    holding_mode text default 'AUTO', holding_fix text, holding_leave_at timestamptz,
    missed_approach_active boolean default false, missed_approach_detected_at timestamptz,
    snapshot jsonb, frozen_tldt timestamptz, revision bigint default 1, updated_at timestamptz
  );
  insert into public.aman_flight_states(callsign, revision) values ('TEST', 40);`);
  const originalMigration = await readFile(new URL('../supabase/migrations/202608190440_aman_shared_state_holding_speed_reconnect.sql', import.meta.url), 'utf8');
  await db.exec(originalMigration.match(/create or replace function public\.bump_aman_state_revision\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec(`create trigger aman_flight_states_touch before update on public.aman_flight_states
    for each row execute function public.bump_aman_state_revision();`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260912144012_separate_aman_target_revision.sql', import.meta.url), 'utf8'));
  const state = async () => (await db.query("select * from public.aman_flight_states where callsign='TEST'")).rows[0];
  assert.equal((await state()).target_revision, 0, 'existing rows are unchanged');
  await db.exec(`update public.aman_flight_states set snapshot='{"speed":240}', frozen_tldt='2026-09-12T10:20:00Z' where callsign='TEST';`);
  assert.equal((await state()).target_revision, 0, 'telemetry + Frozen do not invalidate drags');
  assert.equal((await state()).revision, 41, 'full snapshot ordering still advances');
  const write = async (version, minutes) => (await db.query(`update public.aman_flight_states set target_mode='MANUAL',
    manual_tldt=$1, manual_runway='19' where callsign='TEST' and target_revision=$2 returning *`,
    [`2026-09-12T10:${minutes}:00Z`, version])).rows;
  assert.equal((await write(0, 25))[0].target_revision, 1, 'first manual command wins');
  await db.exec(`update public.aman_flight_states set snapshot='{"speed":235}' where callsign='TEST';`);
  assert.equal((await write(1, 30))[0].target_revision, 2, 'second drag tolerates surveillance refresh');
  assert.equal((await write(1, 35)).length, 0, 'another controller using a stale target is rejected');
  await db.exec(`update public.aman_flight_states set target_mode='AUTO', manual_tldt=null where callsign='TEST';`);
  assert.equal((await state()).target_revision, 3, 'return to AUTO advances commands');
  await db.exec(`update public.aman_flight_states set missed_approach_active=true where callsign='TEST';`);
  assert.equal((await state()).target_revision, 4, 'GA invalidates stale intent');
  await db.exec(`update public.aman_flight_states set canonical_session_id='new-flight' where callsign='TEST';`);
  assert.equal((await state()).target_revision, 5, 'new flight identity invalidates stale intent');
  await db.exec(`update public.aman_flight_states set target_revision=999 where callsign='TEST';`);
  assert.equal((await state()).target_revision, 5, 'counter is database-owned');
  await db.exec(`insert into public.aman_flight_states(callsign,target_revision) values ('NEW',999);`);
  assert.equal((await db.query("select target_revision from public.aman_flight_states where callsign='NEW'")).rows[0].target_revision, 1);
  console.log('PASS: target revision migration, telemetry/Frozen, repeated drags, conflict, AUTO, GA, identity and database-owned counter');
} finally {
  await db.close();
}
