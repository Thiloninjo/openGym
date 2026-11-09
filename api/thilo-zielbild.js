// Thilos Fork: Trainingsdaten fürs Zielbild (thilo/docs/2026-11-09-zielbild.md).
//
// GET /api/thilo/zielbild?key=… liefert eine kompakte Sicht auf den Zustand von ZIELBILD_UID: Plan
// (week, dayPlan), Routinen mit Übungen und die beendeten Trainings mit abgehakten Arbeitssätzen und
// Arbeitsgewicht. Ändert ein Schreiben Plan, Routinen oder Trainings, stößt openGym das Zielbild an
// (POST ZIELBILD_NOTIFY_URL); das Zielbild holt dann neu. Dieses Modul ist rein bis auf den Anstoß;
// server.js liest den Zustand und antwortet. Fehler beim Anstoß landen nur im Log.

import { CATALOG } from './thilo-coach.js';

const NOTIFY_TIMEOUT_MS = 3000;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const BY_ID = new Map(CATALOG.entries.map(e => [e.id, e]));

/** Die Konfiguration aus der Umgebung: `{ok: true, key, uid, notifyUrl}` oder `{ok: false, reason}`. */
export function zielbildConfig(env = process.env) {
  const v = k => String(env[k] || '').trim();
  const key = v('ZIELBILD_KEY');
  if (!key) return { ok: false, reason: 'fehlt: ZIELBILD_KEY' };
  if (key.length < 32) return { ok: false, reason: 'ZIELBILD_KEY kürzer als 32 Zeichen' };
  const uid = v('ZIELBILD_UID') || v('HEALTH_UID');
  if (!uid) return { ok: false, reason: 'fehlt: ZIELBILD_UID (oder HEALTH_UID)' };
  return { ok: true, key, uid, notifyUrl: v('ZIELBILD_NOTIFY_URL') || null };
}

// Kopie von workingWeight aus frontend/src/lib/progression.js (Regel 3 in
// thilo/docs/2026-11-06-progression.md): das schwerste Gewicht, mit dem ein abgehakter Satz die
// Ziel-Wiederholungen (unteres Ende des Bereichs, sonst das Ziel) geschafft hat; sonst das Gewicht
// der meisten Sätze, bei Gleichstand das schwerere. Ohne Last null. Der Test prüft beide Fassungen.
export function workingWeight(sets, target, goal) {
  const done = sets.filter(s => s.done && (Number(s.w) || 0) > 0);
  if (!done.length) return null;
  const need = Number(target?.repsMin) > 0 ? Number(target.repsMin) : goal;
  const hit = done.filter(s => (Number(s.r) || 0) >= need);
  if (hit.length) return Math.max(...hit.map(s => Number(s.w)));
  const count = new Map();
  for (const s of done) count.set(Number(s.w), (count.get(Number(s.w)) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

// Wie phaseForSet/isWarmupRow in frontend/src/lib/workout-model.js.
const isWarmup = s => (s.phase != null && s.phase !== '' ? String(s.phase).toLowerCase() === 'warmup' : s.warmup === true);

// Wie modeOf in frontend/src/lib/history.js.
function modeOf(cfg) {
  const m = cfg && cfg.mode;
  if (m === 'reps' || m === 'time' || m === 'cardio') return m;
  return BY_ID.get(cfg && cfg.id)?.bodyPart === 'cardio' ? 'cardio' : 'reps';
}

function nameOf(id, customs) {
  const c = customs.get(id);
  if (c) return String(c.n || id);
  return CATALOG.name(id) || String(id);
}

// Die Vorgabe einer Übung (Routine oder Training), nur die Felder, die das Zielbild zeigt.
function planOf(cfg) {
  const out = { sets: num(cfg.sets) ?? 1 };
  for (const k of ['reps', 'repsMin', 'weight', 'sec', 'min', 'speed']) if (num(cfg[k]) != null) out[k] = cfg[k];
  if (typeof cfg.note === 'string' && cfg.note.trim()) out.note = cfg.note.trim();
  return out;
}

// Das Arbeitsgewicht einer Session wie in readSession (frontend/src/lib/progression.js): nur die
// geplanten Sätze zählen (Zusatzsätze nicht), Ziel ist `reps` bzw. das höchste `rowReps`.
function sessionWeight(work, target) {
  const rowGoals = Array.isArray(target?.rowReps) && target.rowReps.length ? target.rowReps.map(r => Math.max(0, Number(r) || 0)) : null;
  const planned = rowGoals ? rowGoals.length : (Number(target?.sets) || work.length);
  const sets = target ? work.slice(0, Math.max(1, planned)) : work;
  const goal = rowGoals ? Math.max(...rowGoals) : (Number(target?.reps) || 0);
  return workingWeight(sets, target, goal);
}

// Welche Routine ein Eintrag geplant hat, wie entryRoutineId in frontend/src/lib/history.js.
function entryRoutineId(w, en) {
  if (en?.rid) return en.rid;
  if ((w?.entries || []).some(e => e && e.rid)) return null;
  return [].concat(w?.routineIds ?? [])[0] ?? w?.routineId ?? null;
}

function workoutView(w, customs) {
  const exercises = [];
  for (const en of Array.isArray(w.entries) ? w.entries : []) {
    if (!isMap(en) || typeof en.id !== 'string') continue;
    const target = isMap(en.target) ? en.target : null;
    const mode = modeOf({ ...(target || {}), id: en.id });
    const work = (Array.isArray(en.sets) ? en.sets : []).filter(s => isMap(s) && !isWarmup(s));
    const sets = work.filter(s => s.done).map(s => {
      const o = {};
      for (const k of ['w', 'r', 'sec', 'min', 'speed', 'at']) if (num(s[k]) != null) o[k] = s[k];
      return o;
    });
    exercises.push({
      id: en.id,
      name: nameOf(en.id, customs),
      routineId: entryRoutineId(w, en),
      mode,
      target: target ? planOf(target) : null,
      sets,
      workingWeight: mode === 'reps' ? sessionWeight(work, target) : null,
    });
  }
  const rids = new Set([...[].concat(w.routineIds ?? []), ...(w.routineId ? [w.routineId] : [])]);
  for (const e of exercises) if (e.routineId) rids.add(e.routineId);
  return {
    id: w.id,
    date: w.d,
    name: typeof w.name === 'string' ? w.name : '',
    routineIds: [...rids].filter(id => typeof id === 'string'),
    start: num(w.start),
    end: num(w.end),
    steps: num(w.steps),
    exercises,
  };
}

/** Die Sicht fürs Zielbild aus einem gespeicherten Zustand. Nur beendete, nicht gelöschte Trainings. */
export function buildZielbildView(S, now = Date.now()) {
  const customs = new Map((Array.isArray(S.customEx) ? S.customEx : []).filter(c => isMap(c) && typeof c.id === 'string').map(c => [c.id, c]));
  const deleted = isMap(S.deleted) ? S.deleted : {};
  const week = {};
  for (let wd = 0; wd < 7; wd++) {
    const ids = [].concat(isMap(S.week) ? S.week[wd] ?? [] : []).filter(id => typeof id === 'string');
    if (ids.length) week[wd] = ids;
  }
  const dayPlan = {};
  for (const [d, v] of Object.entries(isMap(S.dayPlan) ? S.dayPlan : {})) if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) dayPlan[d] = v;
  const routines = (Array.isArray(S.routines) ? S.routines : []).filter(r => isMap(r) && typeof r.id === 'string').map(r => ({
    id: r.id,
    name: typeof r.name === 'string' ? r.name : r.id,
    exercises: (Array.isArray(r.ex) ? r.ex : []).filter(e => isMap(e) && typeof e.id === 'string')
      .map(e => ({ id: e.id, name: nameOf(e.id, customs), mode: modeOf(e), ...planOf(e) })),
  }));
  const workouts = (Array.isArray(S.workouts) ? S.workouts : [])
    .filter(w => isMap(w) && w.id != null && !deleted[w.id] && num(w.end) != null && typeof w.d === 'string')
    .map(w => workoutView(w, customs))
    .sort((a, b) => (a.start ?? a.end) - (b.start ?? b.end));
  return { v: 1, rev: num(S._rev), generatedAt: now, week, dayPlan, routines, workouts };
}

// Der Teil des Zustands, den das Zielbild zeigt; ändert er sich, folgt ein Anstoß.
const relevant = S => JSON.stringify(isMap(S) ? [S.week, S.dayPlan, S.routines, S.workouts, S.deleted, S.customEx] : null);

/**
 * Der Auslöser für commitState: `onCommit(uid, cur, next)` prüft synchron und stößt das Zielbild im
 * Hintergrund an. Läufe nie parallel; kommt währenddessen eine weitere Änderung, folgt genau ein Lauf.
 */
export function createZielbildNotify({ uid, url, fetchImpl = globalThis.fetch, log = console.log }) {
  let running = null, again = false;
  async function run() {
    try {
      const r = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'opengym.changed' }), signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      if (!r.ok) log(`thilo-zielbild: Zielbild antwortet ${r.status}`);
    } catch (e) {
      log(`thilo-zielbild: Anstoß fehlgeschlagen: ${e?.message || e}`);
    }
  }
  function kick() {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await run(); } while (again); }
      finally { running = null; }
    })();
    return running;
  }
  return {
    onCommit(u, cur, next) {
      if (u !== uid || relevant(cur) === relevant(next)) return null;
      return kick();
    },
  };
}
