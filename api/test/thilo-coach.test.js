/* Thilos Fork: Coach-Hook (thilo/docs/2026-10-26-coach-hook.md).
   Teil 1 prüft die reine Logik (applyCoachOps, Suche, Konfiguration), Teil 2 den echten server.js
   mit POST /api/thilo/coach und GET /api/thilo/coach/exercises. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundPort } from './helpers.mjs';
import { applyCoachOps, searchExercises, coachHookConfig, keepCoachLive, CATALOG } from '../thilo-coach.js';
import { DE_NAMES } from '../thilo-exercise-names-de.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 0334 dumbbell lateral raise, 0584 lever lateral raise, 0001 3/4 sit-up — alle im Katalog.
const base = () => ({
  unit: 'kg',
  routines: [
    { id: 'r1', name: 'Push', ex: [
      { id: '0334', sets: 3, reps: 12, repsMin: 10, weight: 10, mode: 'reps' },
      { id: '0001', sets: 2, reps: 15, mode: 'reps' },
    ] },
    { id: 'r2', name: 'Pull', ex: [{ id: '0007', sets: 3, reps: 10, mode: 'reps' }] },
  ],
  week: { 1: 'r1', 4: 'r2' },
  dayPlan: { '2026-10-27': 'r2' },
  customEx: [{ id: 'c_seit', n: 'Seitheben am Turm', bp: 'shoulders' }],
});
const opts = { now: () => 1_800_000_000_000, newId: () => 'live1' };

test('Katalog: deutsche Namen sind aktuell gegenüber dem Frontend', async () => {
  const src = path.join(API, '..', 'frontend', 'src', 'exercise-names', 'de.js');
  if (!fs.existsSync(src)) return;
  const { default: de } = await import(pathToFileURL(src).href);
  assert.deepEqual(DE_NAMES, de, 'node thilo/build-exercise-names.mjs ausführen');
});

test('coachHookConfig: Schlüssel ≥ 32, uid aus COACH_UID oder HEALTH_UID', () => {
  const k = 'k'.repeat(32);
  assert.deepEqual(coachHookConfig({ COACH_HOOK_KEY: k, COACH_UID: 'u2', HEALTH_UID: 'u1' }), { ok: true, key: k, uid: 'u2' });
  assert.deepEqual(coachHookConfig({ COACH_HOOK_KEY: k, HEALTH_UID: 'u1' }), { ok: true, key: k, uid: 'u1' });
  assert.equal(coachHookConfig({ COACH_HOOK_KEY: 'kurz', HEALTH_UID: 'u1' }).ok, false);
  assert.match(coachHookConfig({ COACH_HOOK_KEY: k }).reason, /COACH_UID/);
  assert.match(coachHookConfig({}).reason, /COACH_HOOK_KEY/);
});

test('replace-exercise: tauscht, Einstellungen bleiben, cfg überschreibt', () => {
  const S = base();
  const r = applyCoachOps(S, [{ op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: '0584', cfg: { weight: 25 } }], CATALOG, opts);
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.next.routines[0].ex[0], { id: '0584', sets: 3, reps: 12, repsMin: 10, weight: 25, mode: 'reps' });
  assert.equal(r.next.routines[0].ex[1].id, '0001');
  assert.equal(S.routines[0].ex[0].id, '0334', 'Eingabe bleibt unverändert');
  assert.equal(r.applied[0].op, 'replace-exercise');
  assert.equal(r.applied[0].to, 'Seitheben an der Hebelmaschine');
});

test('replace-exercise: eigene Übung aus customEx ist erlaubt', () => {
  const r = applyCoachOps(base(), [{ op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: 'c_seit' }], CATALOG, opts);
  assert.ok(!r.error, r.error);
  assert.equal(r.next.routines[0].ex[0].id, 'c_seit');
});

test('update-exercise: ändert Sätze, Wdh., Gewicht, Notiz; null entfernt', () => {
  const r = applyCoachOps(base(), [{ op: 'update-exercise', routineId: 'r1', exId: '0334', cfg: { sets: 4, reps: 8, repsMin: null, weight: 12.5, note: 'langsam' } }], CATALOG, opts);
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.next.routines[0].ex[0], { id: '0334', sets: 4, reps: 8, weight: 12.5, mode: 'reps', note: 'langsam' });
});

test('update-exercise: ungültige Werte → Fehler', () => {
  const bad = [
    { sets: 0 }, { reps: 1.5 }, { weight: -1 }, { weight: 5000 }, { foo: 1 }, {}, { repsMin: 14 }, { note: 'x'.repeat(201) },
  ];
  for (const cfg of bad) {
    const r = applyCoachOps(base(), [{ op: 'update-exercise', routineId: 'r1', exId: '0334', cfg }], CATALOG, opts);
    assert.ok(r.error, JSON.stringify(cfg));
  }
});

test('set-day: Routine, Ruhetag, Override löschen', () => {
  let r = applyCoachOps(base(), [{ op: 'set-day', date: '2026-10-28', routineId: 'r1' }], CATALOG, opts);
  assert.equal(r.next.dayPlan['2026-10-28'], 'r1');
  r = applyCoachOps(base(), [{ op: 'set-day', date: '2026-10-28', routineId: 'rest' }], CATALOG, opts);
  assert.equal(r.next.dayPlan['2026-10-28'], 'rest');
  r = applyCoachOps(base(), [{ op: 'set-day', date: '2026-10-27', routineId: null }], CATALOG, opts);
  assert.ok(!('2026-10-27' in r.next.dayPlan));
  const noPlan = base(); delete noPlan.dayPlan;
  r = applyCoachOps(noPlan, [{ op: 'set-day', date: '2026-10-28', routineId: 'rest' }], CATALOG, opts);
  assert.deepEqual(r.next.dayPlan, { '2026-10-28': 'rest' });
  for (const date of ['2026-13-01', '2026-02-30', '28.10.2026', null]) {
    assert.ok(applyCoachOps(base(), [{ op: 'set-day', date, routineId: 'rest' }], CATALOG, opts).error, String(date));
  }
});

test('live-swap: schreibt coachLive mit neuer ID, mehrere ops in einem Auftrag', () => {
  const S = base();
  S.coachLive = { id: 'alt', ts: 1, ops: [{ exId: '0001', newExId: '0007' }] };
  const r = applyCoachOps(S, [
    { op: 'live-swap', exId: '0334', newExId: '0584', cfg: { weight: 30 }, note: 'KH belegt' },
    { op: 'live-swap', exId: '0001', newExId: 'c_seit' },
  ], CATALOG, opts);
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.next.coachLive, {
    id: 'live1', ts: 1_800_000_000_000,
    ops: [{ exId: '0334', newExId: '0584', cfg: { weight: 30 }, note: 'KH belegt' }, { exId: '0001', newExId: 'c_seit' }],
  });
  assert.equal(r.applied[0].liveId, 'live1');
  // ohne opts eine zufällige, jedes Mal neue ID
  const a = applyCoachOps(base(), [{ op: 'live-swap', exId: '0334', newExId: '0584' }], CATALOG);
  const b = applyCoachOps(base(), [{ op: 'live-swap', exId: '0334', newExId: '0584' }], CATALOG);
  assert.match(a.next.coachLive.id, /^[0-9a-f]{16}$/);
  assert.notEqual(a.next.coachLive.id, b.next.coachLive.id);
  assert.ok(Number.isFinite(a.next.coachLive.ts));
});

test('keepCoachLive: andere Schreiber behalten den gespeicherten Auftrag', () => {
  const live = { id: 'neu', ts: 2, ops: [{ exId: '0334', newExId: '0584' }] };
  // ein altes Gerät schickt einen älteren Auftrag zurück → der gespeicherte bleibt
  let next = keepCoachLive({ coachLive: live }, { coachLive: { id: 'alt', ts: 1, ops: [] } });
  assert.deepEqual(next.coachLive, live);
  // ein Gerät ohne Auftrag (Backup, Reset) löscht ihn nicht
  next = keepCoachLive({ coachLive: live }, {});
  assert.deepEqual(next.coachLive, live);
  next.coachLive.ops.length = 0;
  assert.equal(live.ops.length, 1, 'Kopie, nicht dieselbe Referenz');
  // gespeichert ist keiner → ein alter aus dem Gerät kommt nicht zurück
  next = keepCoachLive({}, { coachLive: { id: 'alt', ts: 1, ops: [] } });
  assert.equal('coachLive' in next, false);
  next = keepCoachLive(null, { coachLive: { id: 'alt', ts: 1, ops: [] } });
  assert.equal('coachLive' in next, false);
});

test('unbekannte IDs → Fehler', () => {
  const cases = [
    { op: 'replace-exercise', routineId: 'rX', exId: '0334', newExId: '0584' },
    { op: 'replace-exercise', routineId: 'r1', exId: '9999999', newExId: '0584' },
    { op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: 'gibtsnicht' },
    { op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: '0001' },        // schon in der Routine
    { op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: '__proto__' },
    { op: 'update-exercise', routineId: 'r2', exId: '0334', cfg: { sets: 3 } },
    { op: 'set-day', date: '2026-10-28', routineId: 'rX' },
    { op: 'live-swap', exId: 'gibtsnicht', newExId: '0584' },
    { op: 'live-swap', exId: '0334', newExId: 'gibtsnicht' },
    { op: 'gibtsnicht' },
  ];
  for (const op of cases) {
    const r = applyCoachOps(base(), [op], CATALOG, opts);
    assert.ok(r.error && !r.next, JSON.stringify(op));
  }
  for (const ops of [null, [], {}, 'x', Array(26).fill({ op: 'set-day', date: '2026-10-28', routineId: 'rest' })]) {
    assert.ok(applyCoachOps(base(), ops, CATALOG, opts).error);
  }
});

test('alles oder nichts: eine fehlerhafte op verwirft alle', () => {
  const S = base();
  const before = JSON.stringify(S);
  const r = applyCoachOps(S, [
    { op: 'set-day', date: '2026-10-28', routineId: 'rest' },
    { op: 'update-exercise', routineId: 'r1', exId: '0334', cfg: { sets: 99 } },
  ], CATALOG, opts);
  assert.ok(r.error);
  assert.match(r.error, /ops\[1\]/);
  assert.equal(r.next, undefined);
  assert.equal(JSON.stringify(S), before);
});

test('ops wirken nacheinander: Tausch, dann Änderung an der neuen Übung', () => {
  const r = applyCoachOps(base(), [
    { op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: '0584' },
    { op: 'update-exercise', routineId: 'r1', exId: '0584', cfg: { sets: 4 } },
  ], CATALOG, opts);
  assert.ok(!r.error, r.error);
  assert.equal(r.next.routines[0].ex[0].sets, 4);
  assert.equal(r.applied.length, 2);
});

test('Suche: „Seitheben Maschine“, „lateral raise“, eigene Übungen, höchstens 20', () => {
  const S = base();
  const m = searchExercises('Seitheben Maschine', S);
  assert.ok(m.length > 0 && m.length <= 20);
  assert.equal(m[0].id, '0584');
  assert.deepEqual(Object.keys(m[0]).sort(), ['bodyPart', 'en', 'equipment', 'id', 'muscles', 'name']);
  assert.equal(m[0].equipment, 'leverage machine');
  assert.ok(m.every(x => /maschine/i.test(x.name) || /machine/.test(x.equipment)));

  const en = searchExercises('lateral raise', S);
  assert.equal(en.length, 20);
  assert.ok(en.some(x => x.id === '0334'));
  assert.ok(en.every(x => /lateral raise/.test(x.en)));

  const kh = searchExercises('seitheben kurzhantel', S);
  assert.ok(kh.some(x => x.id === '2234'));

  const own = searchExercises('Seitheben Turm', S);
  assert.deepEqual(own.map(x => [x.id, x.custom]), [['c_seit', true]]);

  assert.deepEqual(searchExercises('', S), []);
  assert.deepEqual(searchExercises('xyzzy-gibtsnicht', S), []);
  // Umlaute und Groß-/Kleinschreibung
  assert.ok(searchExercises('KNIEBEUGE', S).length > 0);
});

// ---- Teil 2: echter server.js ----

const SECRET = crypto.randomBytes(32).toString('hex');
const KEY = 'c'.repeat(16) + crypto.randomBytes(16).toString('hex');
const UID = 'u_coach_1';

async function startServer(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-coach-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'Thilo', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({ _rev: 3, _wid: 'w0', workouts: [], bodyweight: [], ...base() }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      HABITS_API_URL: '', HABITS_TOKEN: '', HEALTH_HOOK_KEY: '', HEALTH_UID: '', COACH_HOOK_KEY: '', COACH_UID: '', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.state = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'));
  h.post = (key, body) => fetch(`${h.api}/api/thilo/coach${key == null ? '' : `?key=${encodeURIComponent(key)}`}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  h.search = (key, q) => fetch(`${h.api}/api/thilo/coach/exercises?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`);
  return h;
}

test('Server ohne Konfiguration: 404, eine Logzeile', async t => {
  const h = await startServer(t, {});
  assert.equal((await h.post(KEY, { ops: [] })).status, 404);
  assert.equal((await h.search(KEY, 'x')).status, 404);
  assert.equal((h.log.match(/thilo-coach/g) || []).length, 1);
});

test('Server mit Konfiguration: 403, 400, Schreiben mit rev, Suche', async t => {
  const h = await startServer(t, { COACH_HOOK_KEY: KEY, HEALTH_UID: UID });
  assert.equal((await h.post('falsch', { ops: [] })).status, 403);
  assert.equal((await h.post(null, { ops: [] })).status, 403);
  assert.equal((await h.search('falsch', 'x')).status, 403);
  assert.equal((await fetch(`${h.api}/api/thilo/coach?key=${KEY}`)).status, 404, 'GET auf den Schreibweg');

  // Fehler: 400, nichts geschrieben
  let r = await h.post(KEY, { ops: [{ op: 'set-day', date: '2026-10-28', routineId: 'rest' }, { op: 'replace-exercise', routineId: 'rX', exId: '0334', newExId: '0584' }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /rX/);
  assert.equal(h.state()._rev, 3);

  // Erfolg
  r = await h.post(KEY, { ops: [
    { op: 'replace-exercise', routineId: 'r1', exId: '0334', newExId: '0584' },
    { op: 'set-day', date: '2026-10-28', routineId: 'rest' },
    { op: 'live-swap', exId: '0001', newExId: '0007', note: 'belegt' },
  ] });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.rev, 4);
  assert.equal(body.applied.length, 3);
  const S = h.state();
  assert.ok(S._rev >= 4);
  assert.equal(S.routines[0].ex[0].id, '0584');
  assert.equal(S.dayPlan['2026-10-28'], 'rest');
  assert.equal(S.coachLive.ops[0].newExId, '0007');
  assert.match(S.coachLive.id, /^[0-9a-f]{16}$/);
  assert.ok(S._wids.includes('w0'));
  // server-gestempelt (stamped:false): die Änderungen tragen Zeitstempel
  assert.ok(S.edited && typeof S.edited === 'object');

  // kaputter Body
  r = await fetch(`${h.api}/api/thilo/coach?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(r.status, 400);

  // Suche
  r = await h.search(KEY, 'Seitheben Maschine');
  assert.equal(r.status, 200);
  const hits = await r.json();
  assert.ok(Array.isArray(hits) && hits.length && hits.length <= 20);
  assert.equal(hits[0].id, '0584');
  const own = await (await h.search(KEY, 'Turm')).json();
  assert.equal(own[0].id, 'c_seit');
});

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

test('Server: PUT /api/data bringt keinen alten coachLive zurück und überschreibt keinen neuen', async t => {
  const h = await startServer(t, { COACH_HOOK_KEY: KEY, HEALTH_UID: UID });
  const headers = { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' };
  const get = async () => (await fetch(`${h.api}/api/data`, { headers })).json();
  const put = async body => (await fetch(`${h.api}/api/data`, { method: 'PUT', headers, body: JSON.stringify(body) })).status;

  let r = await h.post(KEY, { ops: [{ op: 'live-swap', exId: '0334', newExId: '0584' }] });
  assert.equal(r.status, 200);
  const live = h.state().coachLive;
  assert.ok(live?.id);
  assert.ok(h.state().edited.coachLive > 0, 'vom Server gestempelt');

  // Die App liest, ändert etwas anderes und schreibt über die gelesene Revision: der Auftrag bleibt.
  let { state, rev } = await get();
  assert.deepEqual(state.coachLive, live);
  assert.equal(await put({ state: { ...state, restSec: 75, coachLive: { id: 'alt', ts: 1, ops: [] } }, baseRev: rev, baseWid: state._wid, stamped: true }), 200);
  assert.deepEqual(h.state().coachLive, live, 'alter Auftrag aus dem Gerät überschreibt den neuen nicht');
  assert.equal(h.state().restSec, 75);

  // Ein Ersetzen ohne baseRev (Backup-Import) ohne coachLive löscht ihn nicht.
  ({ state } = await get());
  const { coachLive, ...rest } = state;
  assert.equal(await put({ state: rest, stamped: true }), 200);
  assert.deepEqual(h.state().coachLive, live);

  // Ein älteres Gerät (stamped:false) ebenso.
  ({ state, rev } = await get());
  assert.equal(await put({ state: { ...state, coachLive: undefined }, baseRev: rev }), 200);
  assert.deepEqual(h.state().coachLive, live);

  // Ein neuer Auftrag vom Hook ersetzt den alten.
  r = await h.post(KEY, { ops: [{ op: 'live-swap', exId: '0001', newExId: '0007' }] });
  assert.equal(r.status, 200);
  assert.notEqual(h.state().coachLive.id, live.id);
  assert.equal(h.state().coachLive.ops[0].exId, '0001');
});
