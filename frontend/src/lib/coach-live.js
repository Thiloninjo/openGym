// Thilos Fork: Live-Tausch des Coaches im laufenden Training (thilo/docs/2026-10-26-coach-hook.md).
//
// Der Coach-Hook auf dem Server legt einen Auftrag `coachLive: {id, ts, ops: [{exId, newExId, cfg?,
// note?}]}` im synchronisierten Zustand ab. Das Training selbst kennt der Server nicht (`active` bleibt
// auf dem Gerät); die App wendet den Auftrag an, sobald sie ihn vom Server holt (store/useStore.js).
// Dieses Modul ist rein: Auftrag + laufendes Training + zuletzt erledigte ID → neues Training,
// Hinweise und die neue erledigte ID.
import { swapActiveExercise } from './active-exercise-swap.js'
import { defaultConfig, modeOf, setUnits, doneUnits } from './history.js'
import { plannedConfigOf } from './session-start.js'
import { isWarmupRow } from './workout-model.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const isId = v => typeof v === 'string' && v.length > 0
const clone = v => JSON.parse(JSON.stringify(v))

/** Ob alle Sätze eines Eintrags erledigt sind (ein Eintrag ohne Sätze ist es nicht). */
export function fullyDone(entry) {
  const sets = Array.isArray(entry?.sets) ? entry.sets : []
  return sets.length > 0 && sets.every(s => doneUnits(s || {}) >= setUnits(s || {}))
}

/**
 * Die Einstellungen der neuen Übung: ihr Standard (wie der „+“ im manuellen Tausch), mit den Sätzen
 * und Wiederholungen (bzw. Sekunden) des Platzes, wenn beide Übungen gleich gezählt werden, dann
 * `cfg` des Auftrags (sets, reps, repsMin, weight; null nimmt repsMin und weight heraus).
 */
export function coachConfig(current, newExId, cfg) {
  const out = defaultConfig(newExId)
  const old = { ...plannedConfigOf(current), id: current?.id }
  const mode = modeOf({ ...out, id: newExId })
  if (mode === modeOf(old)) {
    if (Number(old.sets) > 0) out.sets = old.sets
    if (mode === 'reps') {
      if (Number(old.reps) > 0) out.reps = old.reps
      if (Number(old.repsMin) > 0 && old.repsMin < out.reps) out.repsMin = old.repsMin
    } else if (mode === 'time' && Number(old.sec) > 0) out.sec = old.sec
  }
  if (isMap(cfg)) {
    if (Number.isInteger(cfg.sets) && cfg.sets > 0) out.sets = cfg.sets
    if (Number.isInteger(cfg.reps) && cfg.reps > 0) out.reps = cfg.reps
    if (cfg.repsMin === null) delete out.repsMin
    else if (Number.isInteger(cfg.repsMin) && cfg.repsMin > 0) out.repsMin = cfg.repsMin
    if (Number(out.repsMin) >= Number(out.reps)) delete out.repsMin
    if (cfg.weight === null) out.weight = 0
    else if (Number.isFinite(cfg.weight) && cfg.weight >= 0) out.weight = cfg.weight
  }
  return out
}

// Ein ausdrücklich genanntes Gewicht gilt für die Arbeitssätze, auch wenn der Aufbau aus dem
// Verlauf ein anderes vorgeschlagen hätte.
function withWeight(rep, w) {
  if (!Number.isFinite(w)) return rep
  const out = { ...rep, target: { ...(rep.target || {}), weight: w } }
  if (Array.isArray(rep.sets)) out.sets = rep.sets.map(s => (s && !s.done && !isWarmupRow(s) && typeof s.w === 'number' ? { ...s, w } : s))
  return out
}

/**
 * Wendet den Auftrag `coachLive` auf das laufende Training `active` an.
 *
 * `doneId` ist die ID des zuletzt erledigten Auftrags auf diesem Gerät. `helpers`:
 *   - `build(current, newExId, cfg)` baut den Ersatz wie der manuelle Tausch (lib/swap-replacement.js);
 *   - `nameOf(id)` gibt den Namen, wie die Oberfläche ihn zeigt.
 *
 * Zurück `{active, notices, doneId, inserted}`: `active` ist ein neues Objekt, wenn sich etwas
 * geändert hat (sonst das übergebene), `inserted` die Stellen, an denen ein Ersatz neben erledigte
 * Sätze eingefügt wurde (die Einträge dahinter rücken eins weiter).
 *
 * - Kein Auftrag oder schon erledigt (`id === doneId`, oder am Training vermerkt): nichts.
 * - Kein laufendes Training, die Bearbeitung eines gespeicherten Trainings, oder ein Training, das
 *   erst nach dem Auftrag begonnen hat: der Auftrag verfällt (erledigt), nichts ändert sich.
 * - Sonst für jede op der erste noch nicht ganz erledigte Eintrag mit `exId`: getauscht wie im
 *   manuellen Tausch, mit erledigten Sätzen daneben eingefügt, im Supersatz in der Gruppe.
 */
export function applyCoachLive(active, coachLive, doneId, helpers = {}) {
  const none = { active, notices: [], doneId: doneId ?? null, inserted: [] }
  if (!isMap(coachLive) || !isId(coachLive.id) || coachLive.id === doneId) return none
  const id = coachLive.id
  const expired = { ...none, doneId: id }
  if (!isMap(active) || !Array.isArray(active.entries)) return expired
  if (active.coachLiveId === id) return expired
  if (active.backfill || active.editingWorkoutId != null) return expired
  if (Number(active.start) > 0 && Number(coachLive.ts) > 0 && Number(active.start) > Number(coachLive.ts)) return expired

  const nameOf = typeof helpers.nameOf === 'function' ? helpers.nameOf : x => x
  const build = typeof helpers.build === 'function' ? helpers.build : (cur, exId, cfg) => ({ id: exId, target: { ...cfg, id: exId }, sets: [] })
  const a = clone(active)
  const notices = []
  const inserted = []
  for (const op of Array.isArray(coachLive.ops) ? coachLive.ops : []) {
    if (!isMap(op) || !isId(op.exId) || !isId(op.newExId)) continue
    const idx = a.entries.findIndex(e => e?.id === op.exId && !fullyDone(e))
    if (idx < 0) {
      const there = a.entries.some(e => e?.id === op.exId)
      notices.push(there ? `Coach: ${nameOf(op.exId)} ist schon erledigt` : `Coach: ${nameOf(op.exId)} nicht im Training gefunden`)
      continue
    }
    const current = a.entries[idx]
    const cfg = coachConfig(current, op.newExId, op.cfg)
    let rep = build(current, op.newExId, cfg)
    if (!rep) continue
    if (isMap(op.cfg) && Number.isFinite(op.cfg.weight)) rep = withWeight(rep, op.cfg.weight)
    const oldCur = a.cur
    const res = swapActiveExercise(a, idx, rep, { loggedConfirmed: true, groupDisposition: 'keep' })
    if (!res || res.needsConfirmation) continue
    // Wer gerade an der getauschten Übung ist, landet auf dem Ersatz; sonst bleibt die Auswahl
    // auf ihrer Übung, auch wenn ein eingefügter Ersatz sie eins weiter schiebt.
    if (idx !== oldCur) {
      if (oldCur == null) delete a.cur
      else a.cur = res.inserted && res.index <= oldCur ? oldCur + 1 : oldCur
    }
    if (res.inserted) inserted.push(res.index)
    const note = typeof op.note === 'string' && op.note.trim() ? ` (${op.note.trim()})` : ''
    notices.push(`Coach: ${nameOf(op.exId)} → ${nameOf(op.newExId)}${note}`)
  }
  a.coachLiveId = id
  return { active: a, notices, doneId: id, inserted }
}
