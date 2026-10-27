/* Thilos Fork: Gym in Todoist abhaken (thilo/docs/2026-10-27-gym-todoist.md).
   thilo-todoist.js erkennt ein neues, heute beendetes Training und hakt die heute fällige Aufgabe
   „Gym“ ab. Geprüft ohne Netz mit einem Fake-Fetch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todoistConfig, newFinishedToday, titleMatches, completeGym, createGymTick } from '../thilo-todoist.js';

const NOW = Date.parse('2026-10-27T18:00:00+01:00');
const W = (id, end, extra = {}) => ({ id, d: '2026-10-27', start: end - 3600000, end, name: `T ${id}`, entries: [], ...extra });

test('Konfiguration: Token und Nutzer nötig, Titel standardmäßig „Gym“', () => {
  assert.deepEqual(todoistConfig({}), { ok: false, reason: 'fehlt: TODOIST_TOKEN' });
  assert.equal(todoistConfig({ TODOIST_TOKEN: 't' }).ok, false);
  assert.deepEqual(todoistConfig({ TODOIST_TOKEN: ' t ', HEALTH_UID: 'u1' }), { ok: true, token: 't', uid: 'u1', title: 'Gym' });
  assert.equal(todoistConfig({ TODOIST_TOKEN: 't', HEALTH_UID: 'u1', TODOIST_UID: 'u2', TODOIST_GYM_TITLE: 'Training' }).uid, 'u2');
});

test('nur neue Trainings, die heute (Berlin) beendet wurden', () => {
  const old = W('a', NOW - 7200000);
  const cur = { workouts: [old] };
  assert.deepEqual(newFinishedToday(cur, { workouts: [old] }, NOW), []);
  const fresh = W('b', NOW - 60000);
  assert.deepEqual(newFinishedToday(cur, { workouts: [old, fresh] }, NOW).map(w => w.id), ['b']);
  // nachgetragen für gestern
  const yesterday = W('c', Date.parse('2026-10-26T19:00:00+01:00'), { d: '2026-10-26' });
  assert.deepEqual(newFinishedToday(cur, { workouts: [old, yesterday] }, NOW), []);
  // ohne Ende, ohne Vorzustand, kaputte Einträge
  assert.deepEqual(newFinishedToday(null, { workouts: [W('d', NaN), null, 5] }, NOW), []);
  assert.deepEqual(newFinishedToday(null, { workouts: [fresh] }, NOW).map(w => w.id), ['b']);
  // kurz nach Mitternacht Berlin zählt für den neuen Tag
  const late = Date.parse('2026-10-28T00:10:00+01:00');
  assert.deepEqual(newFinishedToday({}, { workouts: [W('e', late)] }, late).map(w => w.id), ['e']);
});

test('Titel: „[Bereich] “ davor zählt nicht, sonst exakt', () => {
  assert.ok(titleMatches('[Personal] Gym', 'Gym'));
  assert.ok(titleMatches('Gym', 'Gym'));
  assert.ok(titleMatches('  gym ', 'Gym'));
  assert.ok(!titleMatches('[Personal] Gym automatisch abhaken über Open Gym', 'Gym'));
  assert.ok(!titleMatches('Gym App mit Whoop zusammenfügen?', 'Gym'));
  assert.ok(!titleMatches('', 'Gym'));
});

function fakeTodoist(pages, { closeStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
    const u = new URL(url);
    if (u.pathname === '/api/v1/tasks/filter') {
      const page = pages[u.searchParams.get('cursor') || ''];
      return { ok: true, status: 200, json: async () => page };
    }
    return { ok: closeStatus < 400, status: closeStatus, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

test('hakt nur die passende heutige Aufgabe ab, über alle Seiten', async () => {
  const f = fakeTodoist({
    '': { results: [{ id: 'x1', content: '[Personal] Gym automatisch abhaken über Open Gym' }], next_cursor: 'c2' },
    c2: { results: [{ id: 'g1', content: '[Personal] Gym' }, { id: 'g0', content: 'Gym', checked: true }], next_cursor: null },
  });
  const done = await completeGym({ token: 'tok', title: 'Gym' }, f.fetchImpl);
  assert.deepEqual(done, ['[Personal] Gym']);
  const closes = f.calls.filter(c => c.method === 'POST');
  assert.deepEqual(closes.map(c => c.url), ['https://api.todoist.com/api/v1/tasks/g1/close']);
  assert.ok(f.calls.every(c => c.auth === 'Bearer tok'));
  assert.equal(new URL(f.calls[0].url).searchParams.get('query'), 'today');
});

test('HTTP-Fehler wirft', async () => {
  const f = fakeTodoist({ '': { results: [{ id: 'g1', content: 'Gym' }] } }, { closeStatus: 500 });
  await assert.rejects(completeGym({ token: 't', title: 'Gym' }, f.fetchImpl), /500/);
});

test('Auslöser: nur eigener Nutzer, nur neue Trainings, Fehler nur geloggt, nie parallel', async () => {
  const logs = [];
  let n = 0, fail = false, release;
  const complete = () => new Promise((res, rej) => { n++; release = () => (fail ? rej(new Error('down')) : res(['[Personal] Gym'])); });
  const tick = createGymTick({ uid: 'u1', complete, log: m => logs.push(m), now: () => NOW });
  const cur = { workouts: [] }, next = { workouts: [W('a', NOW - 1000)] };

  assert.equal(tick.onCommit('u2', cur, next), null);
  assert.equal(tick.onCommit('u1', next, next), null);
  const p = tick.onCommit('u1', cur, next);
  tick.onCommit('u1', cur, next);          // während des Laufs: genau ein weiterer
  tick.onCommit('u1', cur, next);
  release(); await new Promise(r => setImmediate(r));
  fail = true; release(); await p;
  assert.equal(n, 2);
  assert.ok(logs.some(m => m.includes('abgehakt: [Personal] Gym')));
  assert.ok(logs.some(m => m.includes('Abhaken fehlgeschlagen: down')));
});
