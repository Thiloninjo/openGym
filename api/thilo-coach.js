// Thilos Fork: Coach-Hook (thilo/docs/2026-10-26-coach-hook.md).
//
// Der Coach-Server ändert über POST /api/thilo/coach Routinen und Tagesplan in openGym und legt
// einen Live-Tausch für das laufende Training ab (`coachLive`, die App wendet ihn an). Über
// GET /api/thilo/coach/exercises findet er Übungs-IDs. Dieses Modul ist rein: Prüfen, Anwenden
// und Suchen ohne Datei- oder Netzzugriff; server.js liest, schreibt (commitState) und antwortet.

import crypto from 'node:crypto';
import { LIBRARY, LIB_BY_ID } from './coach/core/library.js';
import { DE_NAMES } from './thilo-exercise-names-de.js';

const MAX_OPS = 25;
const MAX_RESULTS = 20;
const NOTE_MAX = 200;
const MAX_WEIGHT = 1000;                 // wie coach/core/validate.js
const RESERVED_IDS = ['__proto__', 'constructor', 'prototype'];   // wie coach/core/validate.js
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const safeId = v => isStr(v) && v.length <= 64 && !RESERVED_IDS.includes(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Die Konfiguration aus der Umgebung: `{ok: true, key, uid}` oder `{ok: false, reason}`. */
export function coachHookConfig(env = process.env) {
  const v = k => String(env[k] || '').trim();
  const key = v('COACH_HOOK_KEY');
  if (!key) return { ok: false, reason: 'fehlt: COACH_HOOK_KEY' };
  if (key.length < 32) return { ok: false, reason: 'COACH_HOOK_KEY kürzer als 32 Zeichen' };
  const uid = v('COACH_UID') || v('HEALTH_UID');
  if (!uid) return { ok: false, reason: 'fehlt: COACH_UID (oder HEALTH_UID)' };
  return { ok: true, key, uid };
}

/** Der eingebaute Katalog (api/coach/core/library-data.js) mit deutschen Namen, wo vorhanden. */
export const CATALOG = {
  has: id => typeof id === 'string' && LIB_BY_ID.has(id),
  name: id => DE_NAMES[id] || LIB_BY_ID.get(id)?.n || null,
  entries: LIBRARY.map(e => ({ id: e.id, name: DE_NAMES[e.id] || e.n, en: e.n, equipment: e.eq || null, muscles: e.tg || null, bodyPart: e.bp || null })),
};

const customsOf = S => (isMap(S) && Array.isArray(S.customEx) ? S.customEx : []).filter(c => isMap(c) && isStr(c.id));

/* ---------- Suche ---------- */

// Kleinbuchstaben, Umlaute und Akzente abgeflacht (ä → a, ß → ss), damit „Rueckenstrecker“ und
// „Rückenstrecker“ sich gleich verhalten wie die Eingabe ohne Umlaut.
const norm = s => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Sucht im Katalog und in `S.customEx` nach Namen (deutsch und englisch). Jedes Wort der Anfrage
 * muss in Name, englischem Name, Gerät oder Zielmuskel vorkommen. Reihenfolge: ganzer Name gleich,
 * Name beginnt mit der Anfrage, Name enthält sie, ein Name enthält alle Wörter, sonst; dann kürzere
 * Namen zuerst (der kürzere der beiden), dann Katalogreihenfolge (die bekannten Übungen stehen dort
 * vorn). Höchstens 20 Treffer.
 */
export function searchExercises(q, S, catalog = CATALOG, limit = MAX_RESULTS) {
  const query = norm(q);
  if (!query) return [];
  const words = query.split(' ');
  const customs = customsOf(S).map(c => ({ id: c.id, name: String(c.n || c.id), en: null, equipment: null, muscles: null, bodyPart: c.bp || null, custom: true }));
  const hits = [];
  [...customs, ...catalog.entries].forEach((e, i) => {
    const names = [norm(e.name), norm(e.en)].filter(Boolean);
    const hay = [...names, norm(e.equipment), norm(e.muscles)].join(' | ');
    if (!words.every(w => hay.includes(w))) return;
    const tier = names.some(n => n === query) ? 0 : names.some(n => n.startsWith(query)) ? 1 : names.some(n => n.includes(query)) ? 2
      : names.some(n => words.every(w => n.includes(w))) ? 3 : 4;
    hits.push({ e, tier, len: Math.min(...names.map(n => n.length)), i });
  });
  hits.sort((a, b) => a.tier - b.tier || a.len - b.len || a.i - b.i);
  return hits.slice(0, limit).map(({ e }) => {
    const o = { id: e.id, name: e.name, en: e.en, equipment: e.equipment, muscles: e.muscles, bodyPart: e.bodyPart };
    if (e.custom) o.custom = true;
    return o;
  });
}

/* ---------- Ops ---------- */

// Die Satz-Einstellungen einer Übung. `null` entfernt `repsMin`, `weight` und `note`.
const CFG_KEYS = ['sets', 'reps', 'repsMin', 'weight', 'note'];
function cleanCfg(cfg, { required }) {
  if (cfg == null && !required) return { cfg: {} };
  if (!isMap(cfg)) return { error: 'cfg muss ein Objekt sein' };
  const keys = Object.keys(cfg);
  const unknown = keys.filter(k => !CFG_KEYS.includes(k));
  if (unknown.length) return { error: `cfg: unbekannte Felder ${unknown.join(', ')} (erlaubt: ${CFG_KEYS.join(', ')})` };
  if (required && !keys.length) return { error: 'cfg ist leer' };
  const out = {};
  for (const k of keys) {
    const v = cfg[k];
    if (k === 'sets') { if (!isInt(v, 1, 20)) return { error: 'cfg.sets: ganze Zahl 1–20' }; out.sets = v; }
    else if (k === 'reps') { if (!isInt(v, 1, 100)) return { error: 'cfg.reps: ganze Zahl 1–100' }; out.reps = v; }
    else if (k === 'repsMin') { if (v !== null && !isInt(v, 1, 100)) return { error: 'cfg.repsMin: ganze Zahl 1–100 oder null' }; out.repsMin = v; }
    else if (k === 'weight') {
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_WEIGHT)) return { error: `cfg.weight: Zahl 0–${MAX_WEIGHT} oder null` };
      out.weight = v;
    } else if (k === 'note') {
      if (v !== null && typeof v !== 'string') return { error: 'cfg.note: Text oder null' };
      if (typeof v === 'string' && v.length > NOTE_MAX) return { error: `cfg.note: höchstens ${NOTE_MAX} Zeichen` };
      out.note = v === null || !v.trim() ? null : v.trim();
    }
  }
  return { cfg: out };
}
// `cfg` auf eine Übung anwenden (mutiert `ex`); zurück ein Fehler, wenn der Bereich kippt.
function mergeCfg(ex, cfg) {
  for (const [k, v] of Object.entries(cfg)) {
    if (v === null) delete ex[k]; else ex[k] = v;
  }
  if (Number.isInteger(ex.repsMin) && Number.isInteger(ex.reps) && ex.repsMin > ex.reps) return 'repsMin liegt über reps';
  return null;
}

function validDay(s) {
  const m = typeof s === 'string' ? ISO_DAY.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Wendet die ops nacheinander auf eine Kopie von `state` an, alles oder nichts.
 * Zurück `{next, applied}` oder `{error}`; `state` bleibt unverändert.
 * `catalog` ist der eingebaute Katalog (`has`, `name`); eigene Übungen kommen aus `state.customEx`.
 */
export function applyCoachOps(state, ops, catalog = CATALOG, { now = Date.now, newId = () => crypto.randomBytes(8).toString('hex') } = {}) {
  if (!isMap(state)) return { error: 'kein Zustand' };
  if (!Array.isArray(ops) || !ops.length) return { error: 'ops muss eine nicht leere Liste sein' };
  if (ops.length > MAX_OPS) return { error: `höchstens ${MAX_OPS} ops` };
  const next = structuredClone(state);
  const customs = new Map(customsOf(next).map(c => [c.id, c]));
  const known = id => safeId(id) && (catalog.has(id) || customs.has(id));
  const nameOf = id => (customs.has(id) ? String(customs.get(id).n || id) : catalog.name(id)) || id;
  const routines = Array.isArray(next.routines) ? next.routines : [];
  const routineOf = id => (safeId(id) ? routines.find(r => isMap(r) && r.id === id) : null) || null;
  const applied = [];
  const live = [];

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const fail = msg => ({ error: `ops[${i}] (${isMap(o) ? o.op : '?'}): ${msg}` });
    if (!isMap(o)) return fail('kein Objekt');
    if (o.op === 'replace-exercise' || o.op === 'update-exercise') {
      const r = routineOf(o.routineId);
      if (!r) return fail(`Routine "${o.routineId}" nicht gefunden`);
      const list = Array.isArray(r.ex) ? r.ex : [];
      const ex = list.find(e => isMap(e) && e.id === o.exId);
      if (!ex) return fail(`Übung "${o.exId}" ist nicht in Routine "${r.name}" (${r.id})`);
      const c = cleanCfg(o.cfg, { required: o.op === 'update-exercise' });
      if (c.error) return fail(c.error);
      if (o.op === 'replace-exercise') {
        if (!known(o.newExId)) return fail(`Übung "${o.newExId}" gibt es weder im Katalog noch in customEx`);
        if (o.newExId !== o.exId && list.some(e => isMap(e) && e.id === o.newExId)) return fail(`Übung "${o.newExId}" ist schon in Routine "${r.name}"`);
        ex.id = o.newExId;
      }
      const bad = mergeCfg(ex, c.cfg);
      if (bad) return fail(bad);
      applied.push(o.op === 'replace-exercise'
        ? { op: o.op, routineId: r.id, routine: r.name, exId: o.exId, from: nameOf(o.exId), newExId: o.newExId, to: nameOf(o.newExId), cfg: c.cfg }
        : { op: o.op, routineId: r.id, routine: r.name, exId: o.exId, name: nameOf(o.exId), cfg: c.cfg });
    } else if (o.op === 'set-day') {
      if (!validDay(o.date)) return fail(`date "${o.date}" ist kein Datum YYYY-MM-DD`);
      if (o.routineId !== null && o.routineId !== 'rest' && !routineOf(o.routineId)) return fail(`Routine "${o.routineId}" nicht gefunden (oder "rest" / null)`);
      if (!isMap(next.dayPlan)) next.dayPlan = {};
      if (o.routineId === null) delete next.dayPlan[o.date];
      else next.dayPlan[o.date] = o.routineId;
      applied.push({ op: o.op, date: o.date, routineId: o.routineId, ...(isStr(o.routineId) && o.routineId !== 'rest' ? { routine: routineOf(o.routineId).name } : {}) });
    } else if (o.op === 'live-swap') {
      if (!known(o.exId)) return fail(`Übung "${o.exId}" gibt es weder im Katalog noch in customEx`);
      if (!known(o.newExId)) return fail(`Übung "${o.newExId}" gibt es weder im Katalog noch in customEx`);
      if (o.exId === o.newExId) return fail('exId und newExId sind gleich');
      const c = cleanCfg(o.cfg, { required: false });
      if (c.error) return fail(c.error);
      if (o.note != null && (typeof o.note !== 'string' || o.note.length > NOTE_MAX)) return fail(`note: Text bis ${NOTE_MAX} Zeichen`);
      const entry = { exId: o.exId, newExId: o.newExId };
      if (Object.keys(c.cfg).length) entry.cfg = c.cfg;
      if (isStr(o.note)) entry.note = o.note.trim();
      live.push(entry);
      applied.push({ op: o.op, exId: o.exId, from: nameOf(o.exId), newExId: o.newExId, to: nameOf(o.newExId) });
    } else {
      return fail('unbekannte op (replace-exercise, update-exercise, set-day, live-swap)');
    }
  }
  // Alle live-swaps eines Requests bilden einen Auftrag; er ersetzt einen früheren.
  if (live.length) {
    next.coachLive = { id: newId(), ts: now(), ops: live };
    for (const a of applied) if (a.op === 'live-swap') a.liveId = next.coachLive.id;
  }
  return { next, applied };
}
