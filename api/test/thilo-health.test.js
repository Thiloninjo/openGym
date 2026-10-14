/* Thilos Fork: Körpergewicht aus Apple Health (thilo/docs/2026-10-14-gewicht-aus-health.md).
   thilo-health.js holt die Wiegungen von der habits-api und schreibt pro Tag die letzte als
   Körpergewicht. Teil 1 prüft den Abgleich ohne Server (Fake-Fetcher, Schreibweg mit stampPut wie
   PUT /api/data), Teil 2 den Merge der App mit dem Ergebnis (frontend/src/lib/sync-merge.js, wenn
   vorhanden), Teil 3 den echten server.js mit Hook und Zeitplan. */
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
import { stampPut } from '../sync-stamps.js';
import { createHealthSync, healthConfig, berlinDay, keyMatches } from '../thilo-health.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_MERGE = path.join(API, '..', 'frontend', 'src', 'lib', 'sync-merge.js');
const clone = v => JSON.parse(JSON.stringify(v));

const W = (uuid, at, value, extra = {}) => ({ uuid, type: 'weight', value, at, sourceName: 'Withings', deleted: false, rev: 0, ...extra });

// Ein Abgleich gegen einen Speicher im Speicher: Fake-habits-api, Zustand, Spiegel, Schreibweg wie
// PUT /api/data mit `stamped: true` (stampPut, `_rev` + 1).
function harness({ state = { unit: 'kg', bodyweight: [] }, now = () => 1_800_000_000_000 } = {}) {
  const h = { state: clone(state), mirror: null, feed: [], rev: 0, calls: [], logs: [], commits: 0 };
  h.fetchBody = async since => {
    h.calls.push(since);
    if (h.fail) throw new Error('habits-api down');
    return { rev: h.rev, items: h.feed.filter(x => x.rev > since) };
  };
  h.push = (item) => { h.rev++; h.feed.push({ ...item, rev: h.rev }); };
  h.sync = createHealthSync({
    uid: 'u1',
    fetchBody: h.fetchBody,
    readState: () => clone(h.state),
    commit: (uid, cur, next) => {
      stampPut(cur, next, { overRead: true, stamped: true, now: now() });
      next._rev = (cur?._rev || 0) + 1;
      h.state = next;
      h.commits++;
    },
    loadMirror: () => (h.mirror ? clone(h.mirror) : null),
    saveMirror: m => { h.mirror = clone(m); },
    log: (...a) => h.logs.push(a.join(' ')),
    now,
  });
  return h;
}
const day = (h, d) => h.state.bodyweight.find(e => e.d === d);

test('berlinDay: lokales Datum Europe/Berlin', () => {
  assert.equal(berlinDay(Date.parse('2026-10-13T22:30:00Z')), '2026-10-14');   // CEST, 00:30
  assert.equal(berlinDay(Date.parse('2026-12-31T22:59:00Z')), '2026-12-31');   // CET, 23:59
  assert.equal(berlinDay(Date.parse('2026-12-31T23:00:00Z')), '2027-01-01');
});

test('healthConfig: alles da → an; fehlt etwas oder Schlüssel zu kurz → aus mit Grund', () => {
  const ok = { HABITS_API_URL: 'http://127.0.0.1:3004/', HABITS_TOKEN: 't', HEALTH_HOOK_KEY: 'k'.repeat(32), HEALTH_UID: 'u1' };
  assert.deepEqual(healthConfig(ok), { ok: true, url: 'http://127.0.0.1:3004', token: 't', key: 'k'.repeat(32), uid: 'u1' });
  const c = healthConfig({ ...ok, HABITS_TOKEN: '' });
  assert.equal(c.ok, false);
  assert.match(c.reason, /HABITS_TOKEN/);
  assert.match(healthConfig({ ...ok, HEALTH_HOOK_KEY: 'kurz' }).reason, /HEALTH_HOOK_KEY/);
  assert.equal(healthConfig({}).ok, false);
});

test('keyMatches: nur der genaue Schlüssel', () => {
  const k = 'x'.repeat(40);
  assert.equal(keyMatches(k, k), true);
  assert.equal(keyMatches('x'.repeat(39), k), false);
  assert.equal(keyMatches('', k), false);
  assert.equal(keyMatches(null, k), false);
});

test('neue Wiegung → Tageseintrag mit Wiegezeit als t', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80.04));
  await h.sync.sync();
  assert.deepEqual(h.state.bodyweight, [{ d: '2026-10-14', w: 80, t: Date.parse('2026-10-14T05:00:00Z'), src: 'apple-health', hk: 'a' }]);
  assert.equal(h.mirror.rev, 1);
  assert.deepEqual(h.mirror.weights.a, { at: '2026-10-14T05:00:00Z', kg: 80.04, deleted: false });
  assert.deepEqual(h.calls, [0]);
});

test('zwei Wiegungen am Tag → die letzte zählt, Liste nach Tag sortiert', async () => {
  const h = harness({ state: { unit: 'kg', bodyweight: [{ d: '2026-10-20', w: 70, t: 1 }] } });
  h.push(W('b', '2026-10-14T06:00:00Z', 79.5));
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('c', '2026-10-13T05:00:00Z', 81));
  await h.sync.sync();
  assert.deepEqual(h.state.bodyweight.map(e => [e.d, e.w, e.hk]), [['2026-10-13', 81, 'c'], ['2026-10-14', 79.5, 'b'], ['2026-10-20', 70, undefined]]);
});

test('Löschen der letzten → die vorletzte, mit t über dem gespeicherten Eintrag', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('b', '2026-10-14T05:05:00Z', 79));
  await h.sync.sync();
  const before = clone(day(h, '2026-10-14'));
  assert.equal(before.hk, 'b');
  h.push(W('b', '2026-10-14T05:05:00Z', 79, { deleted: true }));
  await h.sync.sync();
  const after = day(h, '2026-10-14');
  assert.equal(after.hk, 'a');
  assert.equal(after.w, 80);
  // Die Wiegezeit (05:00) liegt vor dem gespeicherten t (05:05): ohne den Aufschlag gewänne die
  // alte Kopie eines Geräts den Merge (mergeBodyweight: späteres t).
  assert.equal(after.t, before.t + 1);
  assert.deepEqual(h.calls, [0, 2]);
});

test('Löschen aller → Eintrag weg und als gelöscht vermerkt (nach dem gespeicherten t)', async () => {
  const now = 1_800_000_000_000;
  const h = harness({ now: () => now });
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  const t = day(h, '2026-10-14').t;
  h.push(W('a', '2026-10-14T05:00:00Z', 80, { deleted: true }));
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14'), undefined);
  assert.equal(h.state.deleted.bodyweight['2026-10-14'], Math.max(now, t + 1));
});

test('Löschvermerk mit t in der Zukunft: Stempel liegt hinter dem gespeicherten t', async () => {
  const h = harness({ state: { unit: 'kg', bodyweight: [{ d: '2026-10-14', w: 80, t: 2_000_000_000_000, src: 'apple-health', hk: 'a' }] } });
  h.push(W('a', '2026-10-14T05:00:00Z', 80, { deleted: true }));
  await h.sync.sync();
  assert.equal(h.state.deleted.bodyweight['2026-10-14'], 2_000_000_000_001);
});

test('Handeintrag ohne src bleibt, wenn alle Proben des Tages gelöscht sind', async () => {
  const hand = { d: '2026-10-14', w: 82, t: 5 };
  const h = harness({ state: { unit: 'kg', bodyweight: [hand] } });
  h.push(W('a', '2026-10-14T05:00:00Z', 80, { deleted: true }));
  await h.sync.sync();
  assert.deepEqual(h.state.bodyweight, [hand]);
  assert.equal(h.state.deleted, undefined);
  assert.equal(h.commits, 0);
});

test('Handeintrag mit späterem t wird von einer Wiegung ersetzt, t darüber', async () => {
  const t = Date.parse('2026-10-14T09:00:00Z');
  const h = harness({ state: { unit: 'kg', bodyweight: [{ d: '2026-10-14', w: 82, t }] } });
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  assert.deepEqual(day(h, '2026-10-14'), { d: '2026-10-14', w: 80, t: t + 1, src: 'apple-health', hk: 'a' });
});

test('Wiegung an einem früher gelöschten Tag kommt als wieder hinzugefügt durch', async () => {
  const h = harness({ state: { unit: 'kg', bodyweight: [], deleted: { bodyweight: { '2026-10-14': 1_900_000_000_000 } } } });
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14').w, 80);
  assert.ok(h.state.deleted.bodyweight['2026-10-14'] < 0, 'stampPut (keepHeld) vermerkt das Wiederhinzufügen');
});

test('lb: Umrechnung aus kg, auf 0,1 gerundet', async () => {
  const h = harness({ state: { unit: 'lb', bodyweight: [] } });
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14').w, 176.4);   // 80 / 0.45359237 = 176.37
});

test('rev < since → Merker auf 0, alles neu holen', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('x', '2026-10-12T05:00:00Z', 82));
  h.push(W('y', '2026-10-13T05:00:00Z', 81));
  await h.sync.sync();
  assert.equal(h.mirror.rev, 3);
  // habits-api neu aufgebaut: der Zähler beginnt von vorn und steht unter dem Merker
  h.feed = []; h.rev = 0;
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('b', '2026-10-15T05:00:00Z', 79));
  await h.sync.sync();
  assert.deepEqual(h.calls, [0, 3, 0]);
  assert.equal(h.mirror.rev, 2);
  assert.equal(day(h, '2026-10-15').w, 79);
  assert.ok(h.logs.some(l => /neu aufgebaut/.test(l)));
});

test('Probe wandert auf einen anderen Tag → alter Tag neu berechnet (weg, mit Löschvermerk)', async () => {
  const now = 1_800_000_000_000;
  const h = harness({ now: () => now });
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  const t = day(h, '2026-10-14').t;
  h.push(W('a', '2026-10-15T05:00:00Z', 80));   // Zeit in Apple Health korrigiert
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14'), undefined);
  assert.equal(h.state.deleted.bodyweight['2026-10-14'], Math.max(now, t + 1));
  assert.equal(day(h, '2026-10-15').hk, 'a');
});

test('Neuaufbau der habits-api: sie ist die Wahrheit, verschwundene Tage fallen weg', async () => {
  const now = 1_800_000_000_000;
  const h = harness({ now: () => now, state: { unit: 'kg', bodyweight: [{ d: '2026-10-11', w: 90, t: 1 }] } });
  h.push(W('x', '2026-10-12T05:00:00Z', 82));
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('y', '2026-10-13T05:00:00Z', 81));
  await h.sync.sync();
  const rev0 = h.state._rev;
  // neu aufgebaut: nur noch a (unverändert) und b; x und y sind fort
  h.feed = []; h.rev = 0;
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('b', '2026-10-15T05:00:00Z', 79));
  await h.sync.sync();
  assert.deepEqual(h.calls, [0, 3, 0]);
  assert.deepEqual(h.state.bodyweight.map(e => [e.d, e.w]), [['2026-10-11', 90], ['2026-10-14', 80], ['2026-10-15', 79]]);
  assert.ok(h.state.deleted.bodyweight['2026-10-12'] >= now);
  assert.ok(h.state.deleted.bodyweight['2026-10-13'] >= now);
  assert.equal(h.state.deleted.bodyweight['2026-10-14'], undefined);
  assert.deepEqual(Object.keys(h.mirror.weights).sort(), ['a', 'b']);
  assert.equal(h.mirror.rev, 2);
  assert.equal(h.state._rev, rev0 + 1);
});

test('kaputter Spiegel: unbrauchbare Einträge fallen weg, rev ganzzahlig und ≥ 0, kein Absturz', async () => {
  for (const [rev, since] of [['3.7', 3], [-5, 0], [Infinity, 0], ['x', 0], [null, 0]]) {
    const h = harness();
    h.mirror = { rev, weights: { n: null, q: { at: 'kein Datum', kg: 80 }, r: { at: '2026-10-13T05:00:00Z', kg: 'x' }, s: 5,
      ok: { at: '2026-10-12T05:00:00Z', kg: 82, deleted: false } } };
    h.rev = 10;
    h.feed = [{ ...W('a', '2026-10-14T05:00:00Z', 80), rev: 10 }];
    await h.sync.sync();
    assert.equal(h.calls[0], since);
    assert.deepEqual(Object.keys(h.mirror.weights).sort(), ['a', 'ok']);
    assert.equal(day(h, '2026-10-14').w, 80);
  }
  const h = harness();
  h.mirror = 'Unsinn';
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14').w, 80);
});

test('Antwort ohne ganzzahlige rev ist ein Fehler: Logzeile, nichts geschrieben', async () => {
  for (const rev of [undefined, '3', 2.5, NaN, -1]) {
    const h = harness();
    const sync = createHealthSync({
      uid: 'u1', fetchBody: async () => ({ rev, items: [W('a', '2026-10-14T05:00:00Z', 80)] }),
      readState: () => clone(h.state), commit: () => { throw new Error('darf nicht schreiben'); },
      loadMirror: () => null, saveMirror: m => { h.mirror = m; }, log: (...a) => h.logs.push(a.join(' ')),
    });
    await sync.sync();
    assert.equal(h.mirror, null);
    assert.ok(h.logs.some(l => /rev/.test(l)), `rev=${rev}`);
  }
});

test('keine abgelehnte Promise, auch wenn eine Probe beim Lesen wirft', async () => {
  const h = harness();
  const bad = { get type() { throw new Error('Getter kaputt'); } };
  const sync = createHealthSync({
    uid: 'u1', fetchBody: async () => ({ rev: 1, items: [bad] }),
    readState: () => clone(h.state), commit: () => {}, loadMirror: () => null,
    saveMirror: m => { h.mirror = m; }, log: (...a) => h.logs.push(a.join(' ')),
  });
  await sync.sync();   // wirft nicht
  assert.equal(h.mirror, null);
  assert.ok(h.logs.some(l => /Getter kaputt/.test(l)));
});

test('ungültige Werte werden übersprungen und geloggt', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 'achtzig'));
  h.push(W('b', 'kein Datum', 80));
  h.push(W('c', '2026-10-15T05:00:00Z', -3));
  h.push(W('d', '2026-10-16T05:00:00Z', 900));
  h.push({ type: 'weight', value: 80, at: '2026-10-17T05:00:00Z', rev: 0 });   // ohne uuid
  h.push({ uuid: 'e', type: 'bodyFat', value: 20, at: '2026-10-18T05:00:00Z', deleted: false });   // anderer Typ: still übergangen
  h.push(W('f', '2026-10-19T05:00:00Z', 78.26));
  await h.sync.sync();
  assert.deepEqual(h.state.bodyweight.map(e => [e.d, e.w]), [['2026-10-19', 78.3]]);
  assert.equal(h.logs.filter(l => /ungültig/.test(l)).length, 5);
  assert.deepEqual(Object.keys(h.mirror.weights), ['f']);
  assert.equal(h.mirror.rev, 7);
});

test('_rev steigt nur bei Änderung; Merker wird trotzdem gespeichert', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  assert.equal(h.state._rev, 1);
  await h.sync.sync();                       // nichts Neues
  assert.equal(h.commits, 1);
  h.push(W('a', '2026-10-14T05:00:00Z', 80));  // dieselbe Probe noch einmal gemeldet
  await h.sync.sync();
  assert.equal(h.commits, 1);
  assert.equal(h.state._rev, 1);
  assert.equal(h.mirror.rev, 2);
});

test('Fehler beim Abruf: Logzeile, nichts geändert, der nächste Lauf holt nach', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.fail = true;
  await h.sync.sync();
  assert.equal(h.state.bodyweight.length, 0);
  assert.equal(h.mirror, null);
  assert.ok(h.logs.some(l => /habits-api down/.test(l)));
  h.fail = false;
  await h.sync.sync();
  assert.equal(day(h, '2026-10-14').w, 80);
});

test('Zustand nicht lesbar: nichts geschrieben, Merker bleibt', async () => {
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  const sync = createHealthSync({
    uid: 'u1', fetchBody: h.fetchBody,
    readState: () => { throw new Error('state unreadable'); },
    commit: () => { throw new Error('darf nicht schreiben'); },
    loadMirror: () => null, saveMirror: m => { h.mirror = m; },
    log: (...a) => h.logs.push(a.join(' ')),
  });
  await sync.sync();
  assert.equal(h.mirror, null);
  assert.ok(h.logs.some(l => /state unreadable/.test(l)));
});

test('Läufe nicht parallel; Aufrufe während eines Laufs hängen genau einen weiteren an', async () => {
  const h = harness();
  let release, active = 0, most = 0, runs = 0;
  const gate = new Promise(r => { release = r; });
  const sync = createHealthSync({
    uid: 'u1',
    fetchBody: async () => { runs++; active++; most = Math.max(most, active); if (runs === 1) await gate; active--; return { rev: 0, items: [] }; },
    readState: () => clone(h.state), commit: () => {}, loadMirror: () => null, saveMirror: () => {}, log: () => {},
  });
  const a = sync.sync();
  const b = sync.sync();
  const c = sync.sync();
  release();
  await Promise.all([a, b, c]);
  assert.equal(runs, 2);
  assert.equal(most, 1);
});

// ---- Teil 2: der Merge der App (frontend/src/lib/sync-merge.js) mit dem geschriebenen Zustand ----

test('App-Merge: ein Gerät mit der alten letzten Wiegung übernimmt die vorletzte', async t => {
  if (!fs.existsSync(FRONTEND_MERGE)) return t.skip('kein frontend neben der api');
  const { mergeStates } = await import(pathToFileURL(FRONTEND_MERGE).href);
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('b', '2026-10-14T05:05:00Z', 79));
  await h.sync.sync();
  const device = clone(h.state);             // Gerät hält die 79 (05:05)
  h.push(W('b', '2026-10-14T05:05:00Z', 79, { deleted: true }));
  await h.sync.sync();
  for (const merged of [mergeStates(device, h.state), mergeStates(h.state, device)]) {
    assert.deepEqual(merged.bodyweight.map(e => [e.d, e.w]), [['2026-10-14', 80]]);
  }
});

test('App-Merge: ein Gerät mit dem Eintrag eines gelöschten Tages lässt ihn fallen', async t => {
  if (!fs.existsSync(FRONTEND_MERGE)) return t.skip('kein frontend neben der api');
  const { mergeStates } = await import(pathToFileURL(FRONTEND_MERGE).href);
  const h = harness();
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  h.push(W('x', '2026-10-15T05:00:00Z', 81));
  await h.sync.sync();
  const device = clone(h.state);
  h.push(W('a', '2026-10-14T05:00:00Z', 80, { deleted: true }));
  await h.sync.sync();
  for (const merged of [mergeStates(device, h.state), mergeStates(h.state, device)]) {
    assert.deepEqual(merged.bodyweight.map(e => [e.d, e.w]), [['2026-10-15', 81]]);
  }
});

test('App-Merge: ein später eingetragener Handwert verliert gegen die Wiegung', async t => {
  if (!fs.existsSync(FRONTEND_MERGE)) return t.skip('kein frontend neben der api');
  const { mergeStates } = await import(pathToFileURL(FRONTEND_MERGE).href);
  const h = harness({ state: { unit: 'kg', bodyweight: [{ d: '2026-10-14', w: 82, t: Date.parse('2026-10-14T09:00:00Z') }] } });
  const device = clone(h.state);
  h.push(W('a', '2026-10-14T05:00:00Z', 80));
  await h.sync.sync();
  for (const merged of [mergeStates(device, h.state), mergeStates(h.state, device)]) {
    assert.deepEqual(merged.bodyweight.map(e => [e.d, e.w]), [['2026-10-14', 80]]);
  }
});

// ---- Teil 3: echter server.js, Fake-habits-api im Testprozess ----

const SECRET = crypto.randomBytes(32).toString('hex');
const KEY = 'k'.repeat(16) + crypto.randomBytes(16).toString('hex');
const UID = 'u_health_1';
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

async function fakeHabits(t) {
  const f = { feed: [], rev: 0, hits: 0, auth: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    f.auth.push(req.headers.authorization);
    if (u.pathname !== '/api/body') { res.writeHead(404); return res.end(); }
    const since = +(u.searchParams.get('since') || 0);
    f.hits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rev: f.rev, items: f.feed.filter(x => x.rev > since) }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  f.url = `http://127.0.0.1:${srv.address().port}`;
  f.push = item => { f.rev++; f.feed.push({ ...item, rev: f.rev }); };
  return f;
}

async function startServer(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-health-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'Thilo', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({
    _rev: 3, _wid: 'w0', unit: 'kg', workouts: [], routines: [], bodyweight: [{ d: '2026-01-01', w: 85, t: 1 }]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      HABITS_API_URL: '', HABITS_TOKEN: '', HEALTH_HOOK_KEY: '', HEALTH_UID: '', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.state = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'));
  h.hook = (key, body = { type: 'body.changed' }, method = 'POST') =>
    fetch(`${h.api}/api/thilo/health-hook${key == null ? '' : `?key=${encodeURIComponent(key)}`}`, {
      method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    });
  return h;
}
const until = async (what, ok, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = what(); } catch { v = undefined; }
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error('timeout waiting');
    await new Promise(r => setTimeout(r, 25));
  }
};

test('Server ohne Konfiguration: Hook 404, eine Logzeile, sonst normal', async t => {
  const h = await startServer(t, {});
  const r = await h.hook(KEY);
  assert.equal(r.status, 404);
  assert.equal((h.log.match(/thilo-health/g) || []).length, 1);
  const health = await fetch(`${h.api}/api/health`);
  assert.equal(health.status, 200);
});

test('Server mit Konfiguration: Abgleich beim Start, Hook 403/202, _rev nur bei Änderung', async t => {
  const f = await fakeHabits(t);
  f.push(W('a', '2026-10-14T05:00:00Z', 80));
  const h = await startServer(t, { HABITS_API_URL: f.url, HABITS_TOKEN: 'tok', HEALTH_HOOK_KEY: KEY, HEALTH_UID: UID });

  // beim Start
  let S = await until(h.state, s => s?._rev === 4);
  assert.deepEqual(S.bodyweight.map(e => [e.d, e.w, e.src]), [['2026-01-01', 85, undefined], ['2026-10-14', 80, 'apple-health']]);
  assert.equal(f.auth[0], 'Bearer tok');
  assert.ok(typeof S._wid === 'string' && S._wid !== 'w0');
  assert.ok(S._wids.includes('w0'));
  const mirror = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'thilo-health.json'), 'utf8'));
  assert.equal(mirror.rev, 1);

  // falscher Schlüssel, fehlender Schlüssel, falsche Methode
  assert.equal((await h.hook('falsch')).status, 403);
  assert.equal((await h.hook(null)).status, 403);
  assert.equal((await h.hook(KEY, null, 'GET')).status, 404);

  // anderes Ereignis: 202, aber kein Lauf
  const hits = f.hits;
  assert.equal((await h.hook(KEY, { type: 'habit.changed' })).status, 202);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(f.hits, hits);

  // body.changed ohne Neues: Lauf, aber kein Schreiben
  assert.equal((await h.hook(KEY)).status, 202);
  await until(() => f.hits, n => n === hits + 1);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(h.state()._rev, 4);

  // neue Wiegung → 202, Tageseintrag, _rev + 1, GET /api/data/rev sieht es
  f.push(W('b', '2026-10-15T05:00:00Z', 79.5));
  assert.equal((await h.hook(KEY)).status, 202);
  S = await until(h.state, s => s?._rev === 5);
  assert.equal(S.bodyweight.find(e => e.d === '2026-10-15').w, 79.5);
  const rev = await (await fetch(`${h.api}/api/data/rev`, { headers: { Cookie: `gymsid=${mintSession(UID)}` } })).json();
  assert.equal(rev.rev, 5);
  assert.equal(rev.wid, S._wid);

  // ein Gerät, das noch auf rev 4 schreibt, bekommt 409 wie bei jedem anderen Schreiber
  const put = await fetch(`${h.api}/api/data`, {
    method: 'PUT', headers: { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { unit: 'kg', workouts: [], routines: [], bodyweight: [] }, baseRev: 4, stamped: true })
  });
  assert.equal(put.status, 409);
});
