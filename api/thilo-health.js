// Thilos Fork: Körpergewicht aus Apple Health (thilo/docs/2026-10-14-gewicht-aus-health.md).
//
// Withings → Apple Health → Habit-Tracker-App → habits-api. openGym holt die Wiegungen dort ab
// (`GET /api/body?since=<rev>`), hält alle Gewichtsproben in einem Spiegel
// (`$DATA_DIR/thilo-health.json`: `{rev, weights: {uuid: {at, kg, deleted}}}`) und schreibt pro Tag
// (Europe/Berlin) die letzte nicht gelöschte Probe als Körpergewicht in den Zustand von HEALTH_UID.
//
// Damit der Merge der App (frontend/src/lib/sync-merge.js: pro Tag gewinnt das spätere `t`, eine
// Löschung in `deleted.bodyweight` schlägt jede Kopie mit `t` bis dahin) das Ergebnis nicht
// zurückdreht:
//   - neuer Tag: `t` = Wiegezeit;
//   - ein gespeicherter Tageseintrag wird ersetzt: `t` = max(Wiegezeit, gespeichertes `t` + 1),
//     sonst behielte ein Gerät mit der alten (späteren) Wiegung seine Kopie;
//   - ein Apple-Health-Eintrag fällt weg: `deleted.bodyweight[d]` = max(jetzt, gespeichertes `t` + 1),
//     selbst gestempelt, weil der Schreibweg mit `stamped: true` keine Löschungen vermerkt.
// Handeinträge (ohne `src`) werden nie gelöscht, von einer Wiegung desselben Tages aber ersetzt.

import crypto from 'node:crypto';

const SRC = 'apple-health';
const LB_TO_KG = 0.45359237;
const MAX_BODY_KG = 650;            // wie frontend/src/lib/import-csv.js
const FETCH_TIMEOUT_MS = 15000;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));

/** Die Konfiguration aus der Umgebung: `{ok: true, url, token, key, uid}` oder `{ok: false, reason}`. */
export function healthConfig(env = process.env) {
  const v = k => String(env[k] || '').trim();
  const missing = ['HABITS_API_URL', 'HABITS_TOKEN', 'HEALTH_HOOK_KEY', 'HEALTH_UID'].filter(k => !v(k));
  if (missing.length) return { ok: false, reason: `fehlt: ${missing.join(', ')}` };
  if (v('HEALTH_HOOK_KEY').length < 32) return { ok: false, reason: 'HEALTH_HOOK_KEY kürzer als 32 Zeichen' };
  return { ok: true, url: v('HABITS_API_URL').replace(/\/+$/, ''), token: v('HABITS_TOKEN'), key: v('HEALTH_HOOK_KEY'), uid: v('HEALTH_UID') };
}

/** Schlüsselvergleich in fester Zeit (über SHA-256, damit die Länge nichts verrät). */
export function keyMatches(given, key) {
  if (typeof given !== 'string' || !given || typeof key !== 'string' || !key) return false;
  const h = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(given), h(key));
}

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Das lokale Datum (Europe/Berlin) eines Zeitpunkts als YYYY-MM-DD. */
export function berlinDay(ms) {
  const p = Object.fromEntries(DAY_FMT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Abruf bei der habits-api: `{rev, items}`; wirft bei Netz- oder HTTP-Fehler. */
export function habitsFetcher({ url, token }, fetchImpl = globalThis.fetch) {
  return async since => {
    const r = await fetchImpl(`${url}/api/body?since=${encodeURIComponent(since)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`habits-api antwortet ${r.status}`);
    const body = await r.json();
    if (!isMap(body) || !Array.isArray(body.items)) throw new Error('habits-api: Antwort ohne items');
    return body;
  };
}

// Die Gewichtsproben einer Antwort in den Spiegel; zurück die betroffenen Tage.
function absorb(mirror, items, log) {
  const days = new Set();
  for (const it of items) {
    if (!isMap(it) || it.type !== 'weight') continue;
    const kg = typeof it.value === 'number' ? it.value : NaN;
    const at = typeof it.at === 'string' ? Date.parse(it.at) : NaN;
    const uuid = typeof it.uuid === 'string' && it.uuid ? it.uuid : null;
    if (!uuid || !Number.isFinite(at) || !Number.isFinite(kg) || kg <= 0 || kg > MAX_BODY_KG) {
      log(`thilo-health: ungültige Gewichtsprobe übersprungen (uuid=${String(it.uuid).slice(0, 40)}, value=${String(it.value).slice(0, 20)}, at=${String(it.at).slice(0, 40)})`);
      continue;
    }
    const old = mirror.weights[uuid];
    if (old) days.add(berlinDay(Date.parse(old.at)));
    mirror.weights[uuid] = { at: it.at, kg, deleted: it.deleted === true };
    days.add(berlinDay(at));
  }
  return days;
}

// Die letzte nicht gelöschte Probe jedes Tages.
function latestByDay(mirror, days) {
  const best = new Map();
  for (const [uuid, p] of Object.entries(mirror.weights)) {
    if (p.deleted) continue;
    const at = Date.parse(p.at);
    const d = berlinDay(at);
    if (!days.has(d)) continue;
    const cur = best.get(d);
    if (!cur || at > cur.at || (at === cur.at && uuid > cur.uuid)) best.set(d, { uuid, at, kg: p.kg });
  }
  return best;
}

/** Die betroffenen Tage in `state` übernehmen (mutiert `state`); zurück, ob sich etwas geändert hat. */
export function applyDays(state, mirror, days, now = Date.now()) {
  const unit = state.unit === 'lb' ? 'lb' : 'kg';
  const bw = Array.isArray(state.bodyweight) ? state.bodyweight.filter(isMap) : [];
  const best = latestByDay(mirror, days);
  let changed = false;
  for (const d of days) {
    const i = bw.findIndex(e => e.d === d);
    const stored = i >= 0 ? bw[i] : null;
    const p = best.get(d);
    if (p) {
      const w = Math.round((unit === 'lb' ? p.kg / LB_TO_KG : p.kg) * 10) / 10;
      if (stored && stored.src === SRC && stored.hk === p.uuid && stored.w === w) continue;
      const t = stored ? Math.max(p.at, (Number(stored.t) || 0) + 1) : p.at;
      const entry = { d, w, t, src: SRC, hk: p.uuid };
      if (stored) bw[i] = entry; else bw.push(entry);
      changed = true;
    } else if (stored && stored.src === SRC) {
      bw.splice(i, 1);
      const del = isMap(state.deleted) ? state.deleted : (state.deleted = {});
      const m = isMap(del.bodyweight) ? del.bodyweight : (del.bodyweight = {});
      m[d] = Math.max(now, (Number(stored.t) || 0) + 1);
      changed = true;
    }
  }
  if (changed) state.bodyweight = bw.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  return changed;
}

// Der geladene Spiegel, bereinigt: `rev` ganzzahlig und ≥ 0, nur Proben mit lesbarem `at` und
// endlichem `kg` (eine kaputte Datei darf den Abgleich nicht abbrechen).
function cleanMirror(loaded) {
  const n = isMap(loaded) ? Number(loaded.rev) : NaN;
  const rev = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  const weights = {};
  if (isMap(loaded) && isMap(loaded.weights)) {
    for (const [uuid, p] of Object.entries(loaded.weights)) {
      if (!isMap(p) || typeof p.at !== 'string' || !Number.isFinite(Date.parse(p.at))) continue;
      if (typeof p.kg !== 'number' || !Number.isFinite(p.kg)) continue;
      weights[uuid] = { at: p.at, kg: p.kg, deleted: p.deleted === true };
    }
  }
  return { rev, weights };
}
// Eine Antwort der habits-api braucht eine ganzzahlige `rev` ≥ 0, sonst ist sie ein Fehler.
function checked(body) {
  if (!isMap(body) || !Number.isInteger(body.rev) || body.rev < 0) throw new Error('habits-api: Antwort ohne gültige rev');
  return body;
}

/**
 * Der Abgleich. `fetchBody(since)` → `{rev, items}`; `readState(uid)` liefert den gespeicherten
 * Zustand (wirft, wenn er nicht lesbar ist); `commit(uid, cur, next)` schreibt über den Weg von
 * PUT /api/data. Lesen, Ändern und Schreiben laufen ohne `await` dazwischen.
 * Läufe nie parallel: ein Aufruf während eines Laufs hängt genau einen weiteren an.
 */
export function createHealthSync({ uid, fetchBody, readState, commit, loadMirror, saveMirror, log = console.log, now = Date.now }) {
  async function once() {
    let mirror, body;
    const days = new Set();
    try {
      mirror = cleanMirror(loadMirror());
      body = checked(await fetchBody(mirror.rev));
      if (body.rev < mirror.rev) {
        // Neu aufgebaut: die habits-api ist die Wahrheit. Der Spiegel beginnt leer, und jeder Tag
        // aus dem alten Spiegel wird neu berechnet, damit verschwundene Proben ihren Eintrag verlieren.
        log(`thilo-health: habits-api neu aufgebaut (rev ${body.rev} < ${mirror.rev}), hole alles neu`);
        for (const p of Object.values(mirror.weights)) days.add(berlinDay(Date.parse(p.at)));
        mirror = { rev: 0, weights: {} };
        body = checked(await fetchBody(0));
      }
      for (const d of absorb(mirror, Array.isArray(body.items) ? body.items : [], log)) days.add(d);
    } catch (e) {
      log(`thilo-health: Abruf fehlgeschlagen: ${e?.message || e}`);
      return;
    }
    // Ab hier synchron: lesen, ändern, schreiben.
    try {
      if (days.size) {
        const cur = readState(uid);
        if (!isMap(cur)) { log(`thilo-health: kein Zustand für ${uid}, nichts geschrieben`); return; }
        const next = clone(cur);
        if (applyDays(next, mirror, days, now())) commit(uid, cur, next);
      }
      mirror.rev = Math.max(mirror.rev, body.rev);
      saveMirror(mirror);
    } catch (e) {
      log(`thilo-health: Schreiben fehlgeschlagen: ${e?.message || e}`);
    }
  }
  let running = null, again = false;
  function sync() {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await once(); } while (again); }
      finally { running = null; }
    })();
    return running;
  }
  return { sync };
}

/** Spiegel als Datei (`atomicWrite` von server.js). */
export function fileMirror(file, write, fs) {
  return {
    load: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    save: m => write(file, JSON.stringify(m)),
  };
}
