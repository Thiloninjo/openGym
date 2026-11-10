// Thilos Fork: Zielkarte, Satzvergleich und Progressions-Kachel (thilo/docs/2026-11-10-progression-push.md).
// Reine Funktionen: aus dem Ergebnis der Progression (entry.plan), dem letzten Mal (lastEntryFor, nur
// Arbeitssätze) und den heutigen Sätzen wird, was Karte, Satzzeile und Abschluss anzeigen.
import { normalizeRepRange } from './rep-range.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { setLabel } from './history.js'
import { fmtNum } from './format.js'
import { t } from './i18n-core.js'

const EPS = 1e-9
const round2 = v => Math.round(v * 100) / 100
const topWeight = sets => (sets || []).reduce((m, s) => Math.max(m, Number(s.w) || 0), 0)
const repsSum = sets => (sets || []).reduce((n, s) => n + (Number(s.r) || 0), 0)

/** „52 kg · 12 · 11“ bei einem Gewicht, sonst die Sätze einzeln („52×12 · 57×8“); ohne letztes Mal null. */
export function lastText(last, id, unit, speedUnit) {
  const sets = last?.sets || []
  if (!sets.length) return null
  const w = Number(sets[0].w) || 0
  const oneWeight = w > 0 && sets.every(s => Number(s.r) > 0 && !(s.sec > 0) && !(s.min > 0) && Math.abs((Number(s.w) || 0) - w) < EPS)
  if (oneWeight) return `${fmtNum(w)} ${unit} · ` + sets.map(s => s.r).join(' · ')
  return sets.map(s => setLabel(id, s, last.target, speedUnit)).join(' · ')
}

/** Arbeitssätze des letzten Mals unter dessen Ziel: [{ n: Satznummer, short: fehlende Wdh. }]. */
function shortSets(last) {
  const goal = Number(last?.target?.reps) || 0
  if (!goal) return []
  return (last.sets || [])
    .map((s, i) => ({ n: i + 1, r: Number(s.r) || 0 }))
    .filter(x => x.r > 0 && x.r < goal)
    .map(x => ({ n: x.n, short: goal - x.r }))
}

/**
 * Die Zielkarte einer Übung oder null.
 * plan: entry.plan · last: lastEntryFor(…) · planned: entry.planned (Wiederholungsbereich der Routine)
 * mode: reps | time | cardio · unit: S.unit · id: Übungs-ID · speedUnit: für setLabel
 */
export function targetCard({ plan, last, planned, mode, unit, id, speedUnit }) {
  if (!plan || mode === 'cardio' || plan.policy === 'off' || plan.kind === 'off' || plan.kind === 'first') return null
  const lastLine = last ? lastText(last, id, unit, speedUnit) : null
  const card = (tone, head, sub = null, extra = null) => ({ tone, head, sub, extra, last: lastLine })
  if (mode === 'time') {
    if (plan.kind === 'deload') return plan.why ? card('down', plan.why) : null
    return plan.sec > 0 ? card(plan.kind === 'up' ? 'up' : 'hold', ['Today: hold {0} s', plan.sec]) : null
  }
  const w = Number(plan.weight) || 0
  if (plan.kind === 'deload') return card('down', ['Today lighter: {0} {1}', fmtNum(w), unit], plan.why || null)
  if (plan.kind === 'up') {
    const before = last ? topWeight(last.sets) : 0
    if (before > 0 && w > before + EPS) {
      const range = planned?.reps > 0 ? normalizeRepRange(planned.reps, planned.repsMin) : null
      return card('up', ['Today: 1 step up'], range
        ? ['≈ {0} {1} · {2}–{3} reps', fmtNum(w), unit, range.repsMin, range.reps]
        : ['≈ {0} {1}', fmtNum(w), unit])
    }
    return plan.why ? card('up', plan.why) : null
  }
  const short = shortSets(last)
  const extra = short.length === 1 ? ['Last time set {0} was {1} rep short. Get it today.', short[0].n, short[0].short]
    : short.length > 1 ? ['Last time {0} sets fell short. Get them today.', short.length] : null
  const withW = w > 0 ? ['with {0} {1}', fmtNum(w), unit] : null
  if (plan.reps > 0) return card('hold', ['Today: {0} reps per set', plan.reps], withW, extra)
  if (short.length) return card('hold', ['Today: get the missing reps'], withW)
  return plan.why ? card('hold', plan.why, withW) : null
}

/** Der Arbeitssatz des letzten Mals zu Zeile i von heute (Aufwärmsätze zählen nicht), oder null. */
export function prevSetAt(last, sets, i) {
  const s = sets?.[i]
  if (!s || isWarmupRow(s) || isSideSet(s)) return null
  const k = sets.slice(0, i + 1).filter(x => !isWarmupRow(x)).length - 1
  return last?.sets?.[k] ?? null
}

/** Satz heute gegen denselben Arbeitssatz letztes Mal: { sign: 1 | 0 | -1, text } oder null. */
export function setDelta(prev, cur, { mode, unit, assisted = false }) {
  if (!prev || !cur) return null
  if (mode === 'time') {
    if (!(cur.sec > 0) || !(prev.sec > 0)) return null
    const ds = Math.round(cur.sec - prev.sec)
    return ds > 0 ? { sign: 1, text: `+${ds} s` } : ds < 0 ? { sign: -1, text: `−${-ds} s` } : { sign: 0, text: '=' }
  }
  if (mode !== 'reps' || !(Number(cur.r) > 0) || !(Number(prev.r) > 0)) return null
  const dw = round2((Number(cur.w) || 0) - (Number(prev.w) || 0))
  if (Math.abs(dw) > EPS) {
    // An einer Maschine mit Hilfe ist weniger Gewicht weniger Hilfe, also besser.
    const sign = (dw > 0) !== assisted ? 1 : -1
    return { sign, text: `${dw > 0 ? '+' : '−'}${fmtNum(Math.abs(dw))} ${unit}` }
  }
  const dr = Math.round(cur.r) - Math.round(prev.r)
  return dr > 0 ? { sign: 1, text: `+${dr}` } : dr < 0 ? { sign: -1, text: `−${-dr}` } : { sign: 0, text: '=' }
}

/** Für den Abschluss: gesteigerte Übungen (trend > 0 aus finishCompare) mit ihrem Plus, von allen mit letztem Mal. */
export function progressCount(rows, unit) {
  const withLast = (rows || []).filter(r => r.last?.length)
  const up = withLast.filter(r => r.trend > 0).map(r => {
    const dw = round2(topWeight(r.today) - topWeight(r.last))
    return { id: r.id, plus: dw > EPS ? `+${fmtNum(dw)} ${unit}` : t('+{0} reps', repsSum(r.today) - repsSum(r.last)) }
  })
  return { up, of: withLast.length }
}
