// Thilos Fork: Gym in Todoist abhaken (thilo/docs/2026-10-27-gym-todoist.md).
//
// Kommt mit einem Schreiben in den Zustand von TODOIST_UID ein neues beendetes Training von heute
// (Europe/Berlin) dazu, hakt openGym in Todoist die heute fällige, offene Aufgabe „Gym“ ab. Ein
// vorangestelltes „[Bereich] “ zählt nicht mit („[Personal] Gym“ passt, „Gym App …“ nicht).
// Nachgetragene oder importierte Trainings anderer Tage lösen nichts aus. Fehler werden nur
// geloggt; das Training ist da schon gespeichert.

import { berlinDay } from './thilo-health.js';

const API = 'https://api.todoist.com/api/v1';
const FETCH_TIMEOUT_MS = 15000;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Die Konfiguration aus der Umgebung: `{ok: true, token, uid, title}` oder `{ok: false, reason}`. */
export function todoistConfig(env = process.env) {
  const v = k => String(env[k] || '').trim();
  const token = v('TODOIST_TOKEN');
  if (!token) return { ok: false, reason: 'fehlt: TODOIST_TOKEN' };
  const uid = v('TODOIST_UID') || v('HEALTH_UID');
  if (!uid) return { ok: false, reason: 'fehlt: TODOIST_UID (oder HEALTH_UID)' };
  return { ok: true, token, uid, title: v('TODOIST_GYM_TITLE') || 'Gym' };
}

/** Die Trainings in `next`, die `cur` noch nicht hatte und die heute beendet wurden. */
export function newFinishedToday(cur, next, now = Date.now()) {
  const list = S => (isMap(S) && Array.isArray(S.workouts) ? S.workouts.filter(isMap) : []);
  const seen = new Set(list(cur).map(w => w.id));
  const today = berlinDay(now);
  return list(next).filter(w => w.id != null && !seen.has(w.id)
    && Number.isFinite(w.end) && berlinDay(w.end) === today);
}

/** Passt der Aufgabentitel? Ohne „[Bereich] “ davor, ohne Groß/Klein. */
export function titleMatches(content, title) {
  const bare = String(content || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim().toLowerCase();
  return bare === String(title).trim().toLowerCase();
}

/** Hakt die heute fälligen, offenen Gym-Aufgaben ab; zurück ihre Titel. Wirft bei Netz- oder HTTP-Fehler. */
export async function completeGym({ token, title }, fetchImpl = globalThis.fetch) {
  const call = async (p, init = {}) => {
    const r = await fetchImpl(`${API}${p}`, {
      ...init, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`Todoist antwortet ${r.status} auf ${p.split('?')[0]}`);
    return r;
  };
  const tasks = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ query: 'today', limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const body = await (await call(`/tasks/filter?${q}`)).json();
    if (!isMap(body) || !Array.isArray(body.results)) throw new Error('Todoist: Antwort ohne results');
    tasks.push(...body.results);
    cursor = body.next_cursor || null;
  } while (cursor);
  const hits = tasks.filter(t => isMap(t) && !t.checked && typeof t.id === 'string' && titleMatches(t.content, title));
  for (const t of hits) await call(`/tasks/${encodeURIComponent(t.id)}/close`, { method: 'POST' });
  return hits.map(t => t.content);
}

/**
 * Der Auslöser für commitState: `onCommit(uid, cur, next)` prüft synchron und hakt im Hintergrund
 * ab. Läufe nie parallel; kommt währenddessen ein weiteres Training, folgt genau ein Lauf.
 */
export function createGymTick({ uid, complete, log = console.log, now = Date.now }) {
  let running = null, again = false;
  async function run() {
    try {
      const done = await complete();
      log(done.length ? `thilo-todoist: abgehakt: ${done.join(', ')}` : 'thilo-todoist: keine offene Gym-Aufgabe für heute');
    } catch (e) {
      log(`thilo-todoist: Abhaken fehlgeschlagen: ${e?.message || e}`);
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
      if (u !== uid) return null;
      const fresh = newFinishedToday(cur, next, now());
      if (!fresh.length) return null;
      log(`thilo-todoist: Training beendet (${fresh.map(w => w.name || w.id).join(', ')})`);
      return kick();
    },
  };
}
