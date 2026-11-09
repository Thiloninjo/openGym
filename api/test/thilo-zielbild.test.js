// Thilos Fork: Trainingsdaten fürs Zielbild (thilo-zielbild.js). Teil 1 prüft die reinen Funktionen
// und den Anstoß mit einem falschen fetch, Teil 2 den echten server.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boundPort } from './helpers.mjs';
import { zielbildConfig, workingWeight, buildZielbildView, createZielbildNotify } from '../thilo-zielbild.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PROGRESSION = path.join(here, '..', '..', 'frontend', 'src', 'lib', 'progression.js');
const KEY = 'k'.repeat(32);

test('Konfiguration: Schlüssel und Nutzer nötig, Anstoß-Adresse optional', () => {
  assert.deepEqual(zielbildConfig({}), { ok: false, reason: 'fehlt: ZIELBILD_KEY' });
  assert.equal(zielbildConfig({ ZIELBILD_KEY: 'kurz' }).ok, false);
  assert.equal(zielbildConfig({ ZIELBILD_KEY: KEY }).reason, 'fehlt: ZIELBILD_UID (oder HEALTH_UID)');
  assert.deepEqual(zielbildConfig({ ZIELBILD_KEY: KEY, HEALTH_UID: 'u1' }), { ok: true, key: KEY, uid: 'u1', notifyUrl: null });
  assert.deepEqual(zielbildConfig({ ZIELBILD_KEY: KEY, ZIELBILD_UID: 'u2', HEALTH_UID: 'u1', ZIELBILD_NOTIFY_URL: 'http://127.0.0.1:3007/x' }),
    { ok: true, key: KEY, uid: 'u2', notifyUrl: 'http://127.0.0.1:3007/x' });
});

const S = (sets) => sets.map(([w, r, done = true]) => ({ w, r, done }));

test('Arbeitsgewicht: schwerster Satz mit Ziel-Wdh., sonst das häufigste Gewicht', () => {
  assert.equal(workingWeight(S([[30, 12], [30, 12], [50, 3]]), { repsMin: 8, reps: 12 }, 12), 30);
  assert.equal(workingWeight(S([[30, 6], [30, 6], [35, 5]]), { repsMin: 8, reps: 12 }, 12), 30);
  assert.equal(workingWeight(S([[30, 6], [35, 5]]), { repsMin: 8, reps: 12 }, 12), 35);
  assert.equal(workingWeight(S([[0, 12]]), { reps: 12 }, 12), null);
  assert.equal(workingWeight(S([[40, 12, false]]), { reps: 12 }, 12), null);
});

test('Arbeitsgewicht: gleiche Ergebnisse wie die Fassung im Frontend', async t => {
  if (!fs.existsSync(FRONTEND_PROGRESSION)) return t.skip('kein frontend neben der api');
  const mod = await import(pathToFileURL(FRONTEND_PROGRESSION).href);
  if (typeof mod.workingWeight !== 'function') return t.skip('Frontend ohne workingWeight');
  const cases = [
    [S([[30, 12], [30, 12], [50, 3]]), { repsMin: 8, reps: 12 }, 12],
    [S([[30, 6], [30, 6], [35, 5]]), { repsMin: 8, reps: 12 }, 12],
    [S([[30, 6], [35, 5]]), { repsMin: 8, reps: 12 }, 12],
    [S([[20, 10], [22.5, 10], [25, 9]]), { reps: 10 }, 10],
    [S([[0, 12]]), { reps: 12 }, 12],
    [[], { reps: 12 }, 12],
  ];
  for (const c of cases) assert.equal(workingWeight(...c), mod.workingWeight(...c));
});

const state = () => ({
  _rev: 7,
  week: { 0: ['rB'], 1: ['rA'], 3: [], 5: 'rS' },
  dayPlan: { '2026-11-11': 'rS', '2026-11-13': 'rest', kaputt: 'rA' },
  routines: [
    { id: 'rA', name: 'Cut-Vorschau Mo · Oberkörper A', ex: [{ id: '0739', sets: 3, reps: 12, repsMin: 8, weight: 0, mode: 'reps', note: ' Füße tief ' }] },
    { id: 'rS', name: 'Sprints', ex: [{ id: '5216', sets: 6, sec: 15, mode: 'time' }] },
    { id: 'rB', name: 'Beine B', ex: [{ id: 'eigen1', sets: 2, reps: 10 }] },
  ],
  customEx: [{ id: 'eigen1', n: 'Meine Übung' }],
  deleted: { wDel: 1 },
  workouts: [
    { id: 'w2', d: '2026-11-03', start: 2000, end: 2600, routineIds: ['rA'], routineId: 'rA', name: 'Cut-Vorschau Mo · Oberkörper A', steps: 900,
      entries: [{ id: '0739', rid: 'rA', target: { sets: 3, reps: 12, repsMin: 8, weight: 80 },
        sets: [{ w: 40, r: 10, done: true, phase: 'warmup' }, { w: 80, r: 12, done: true, at: 2100 }, { w: 100, r: 9, done: true, at: 2200 }, { w: 120, r: 4, done: true, at: 2300 }, { w: 130, r: 1, done: true, at: 2400 }, { w: 90, r: 8, done: false }] }] },
    { id: 'w1', d: '2026-11-02', start: 1000, end: 1500, routineId: 'rB', name: 'Beine B', entries: [{ id: 'eigen1', sets: [{ w: 10, r: 10, done: true }] }] },
    { id: 'wDel', d: '2026-11-04', start: 3000, end: 3100, name: 'gelöscht', entries: [] },
    { id: 'wRun', d: '2026-11-05', start: 4000, name: 'läuft noch', entries: [] },
  ],
});

test('Sicht: Plan bereinigt, Routinen mit Namen und Vorgaben', () => {
  const v = buildZielbildView(state(), 99);
  assert.equal(v.v, 1);
  assert.equal(v.rev, 7);
  assert.equal(v.generatedAt, 99);
  assert.deepEqual(v.week, { 0: ['rB'], 1: ['rA'], 5: ['rS'] });
  assert.deepEqual(v.dayPlan, { '2026-11-11': 'rS', '2026-11-13': 'rest' });
  assert.deepEqual(v.routines[0].exercises[0], { id: '0739', name: v.routines[0].exercises[0].name, mode: 'reps', sets: 3, reps: 12, repsMin: 8, weight: 0, note: 'Füße tief' });
  assert.deepEqual(v.routines[1].exercises[0], { id: '5216', name: v.routines[1].exercises[0].name, mode: 'time', sets: 6, sec: 15 });
  assert.equal(v.routines[2].exercises[0].name, 'Meine Übung');
});

test('Sicht: nur beendete, nicht gelöschte Trainings, sortiert; Arbeitssätze ohne Aufwärmen', () => {
  const v = buildZielbildView(state());
  assert.deepEqual(v.workouts.map(w => w.id), ['w1', 'w2']);
  const w2 = v.workouts[1];
  assert.deepEqual(w2.routineIds, ['rA']);
  assert.equal(w2.steps, 900);
  const e = w2.exercises[0];
  assert.equal(e.routineId, 'rA');
  assert.deepEqual(e.sets, [{ w: 80, r: 12, at: 2100 }, { w: 100, r: 9, at: 2200 }, { w: 120, r: 4, at: 2300 }, { w: 130, r: 1, at: 2400 }]);
  // Nur die 3 geplanten Sätze zählen; 100×9 ist der schwerste mit ≥ 8 Wdh.
  assert.equal(e.workingWeight, 100);
  assert.deepEqual(e.target, { sets: 3, reps: 12, repsMin: 8, weight: 80 });
  assert.deepEqual(v.workouts[0].routineIds, ['rB']);
  assert.equal(v.workouts[0].exercises[0].routineId, 'rB');
});

test('Anstoß: nur für den Nutzer und nur, wenn sich Plan, Routinen oder Trainings ändern', async () => {
  const calls = [];
  const n = createZielbildNotify({ uid: 'u1', url: 'http://z/hook', fetchImpl: async (url, init) => { calls.push([url, init.method, init.body]); return { ok: true }; }, log: () => {} });
  const cur = state();
  assert.equal(n.onCommit('u2', cur, { ...cur, workouts: [] }), null);
  assert.equal(n.onCommit('u1', cur, { ...cur, bodyweight: [{ d: '2026-11-09', w: 70 }] }), null);
  await n.onCommit('u1', cur, { ...cur, workouts: [] });
  assert.deepEqual(calls, [['http://z/hook', 'POST', JSON.stringify({ type: 'opengym.changed' })]]);
});

test('Anstoß: Fehler nur im Log, Läufe nicht parallel', async () => {
  const logs = [];
  let open = 0, most = 0;
  const n = createZielbildNotify({ uid: 'u1', url: 'http://z/hook', log: m => logs.push(m), fetchImpl: async () => {
    open++; most = Math.max(most, open);
    await new Promise(r => setTimeout(r, 5));
    open--;
    throw new Error('weg');
  } });
  const cur = state();
  const a = n.onCommit('u1', cur, { ...cur, workouts: [] });
  n.onCommit('u1', cur, { ...cur, routines: [] });
  await a;
  assert.equal(most, 1);
  assert.ok(logs.length >= 1 && logs.every(m => m.includes('Anstoß fehlgeschlagen: weg')));
});

// ---- Teil 2: echter server.js, Leseroute und Anstoß nach einem Schreiben über den Coach-Hook ----

const API = path.join(here, '..');
const UID = 'u_zb_1';
const COACH_KEY = 'c'.repeat(32);

async function startServer(t, env) {
  const hits = [];
  const sink = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => { hits.push({ url: req.url, method: req.method, body }); res.writeHead(202); res.end('{}'); });
  });
  await new Promise(r => sink.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-zb-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'Thilo', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({ _wid: 'w0', bodyweight: [], ...state(), _rev: 3 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      HABITS_API_URL: '', HABITS_TOKEN: '', HEALTH_HOOK_KEY: '', HEALTH_UID: UID, COACH_HOOK_KEY: COACH_KEY, COACH_UID: '',
      TODOIST_TOKEN: '', ZIELBILD_KEY: '', ZIELBILD_UID: '', ZIELBILD_NOTIFY_URL: `http://127.0.0.1:${sink.address().port}/api/hooks/opengym?key=x`, ...env }
  });
  const h = { log: '', hits };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); sink.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.get = key => fetch(`${h.api}/api/thilo/zielbild${key == null ? '' : `?key=${encodeURIComponent(key)}`}`);
  h.coach = ops => fetch(`${h.api}/api/thilo/coach?key=${COACH_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
  h.state = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'));
  return h;
}

test('Server ohne ZIELBILD_KEY: 404, kein Anstoß', async t => {
  const h = await startServer(t, {});
  assert.equal((await h.get(KEY)).status, 404);
  assert.match(h.log, /thilo-zielbild: aus \(fehlt: ZIELBILD_KEY\)/);
  assert.equal((await h.coach([{ op: 'set-week', weekday: 3, routineIds: ['rS'] }])).status, 200);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(h.hits.length, 0);
});

test('Server mit ZIELBILD_KEY: 403, Sicht, Anstoß nach Routine und Wochenplan', async t => {
  const h = await startServer(t, { ZIELBILD_KEY: KEY });
  assert.match(h.log, /thilo-zielbild: an \(Nutzer u_zb_1, Anstoß an\)/);
  assert.equal((await h.get('falsch')).status, 403);
  assert.equal((await h.get(null)).status, 403);
  assert.equal((await fetch(`${h.api}/api/thilo/zielbild?key=${KEY}`, { method: 'POST' })).status, 404);

  let r = await h.get(KEY);
  assert.equal(r.status, 200);
  let v = await r.json();
  assert.equal(v.rev, 3);
  assert.deepEqual(v.workouts.map(w => w.id), ['w1', 'w2']);

  r = await h.coach([{ op: 'add-routine', name: 'Laufband', emoji: 'timer', exercises: [{ exId: '3666', cfg: { min: 30, speed: 5 } }] }]);
  assert.equal(r.status, 200);
  const id = (await r.json()).applied[0].routineId;
  r = await h.coach([{ op: 'set-week', weekday: 6, routineIds: [id] }]);
  assert.equal(r.status, 200);
  for (let i = 0; i < 50 && h.hits.length < 2; i++) await new Promise(res => setTimeout(res, 20));
  assert.equal(h.hits.length, 2);
  assert.deepEqual(h.hits[0], { url: '/api/hooks/opengym?key=x', method: 'POST', body: JSON.stringify({ type: 'opengym.changed' }) });

  v = await (await h.get(KEY)).json();
  assert.deepEqual(v.week[6], [id]);
  assert.equal(v.routines.at(-1).name, 'Laufband');
  assert.equal(v.routines.at(-1).exercises[0].mode, 'cardio');
  // vom Server gestempelt, damit ein Gerät mit älterem Stand die Routine nicht verliert
  const S = h.state();
  assert.ok(S.routines.at(-1)._ts > 0);
  assert.ok(Object.keys(S.edited || {}).includes('week.6'));
});
