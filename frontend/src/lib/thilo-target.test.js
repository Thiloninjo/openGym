// Thilos Fork: Zielkarte, Satzvergleich und Progressions-Kachel (lib/thilo-target.js).
import { describe, expect, it } from 'vitest'
import { targetCard, setDelta, prevSetAt, progressCount, lastText } from './thilo-target.js'

const last = (sets, reps = 12) => ({ d: '2026-11-05', sets: sets.map(([w, r]) => ({ w, r, done: true })), target: { sets: sets.length, reps } })
const base = { mode: 'reps', unit: 'kg', id: 'x', planned: { sets: 3, reps: 12, repsMin: 8 } }

describe('targetCard', () => {
  it('alle Sätze oben: eine Stufe höher mit ≈ Gewicht und Bereich, darunter das letzte Mal', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'up', weight: 57, reps: 8, why: ['…'] }, last: last([[52, 12], [52, 12], [52, 12]]) })
    expect(c).toEqual({ tone: 'up', head: ['Today: 1 step up'], sub: ['≈ {0} {1} · {2}–{3} reps', '57', 'kg', 8, 12], extra: null, last: '52 kg · 12 · 12 · 12' })
  })
  it('up ohne höheres Gewicht (Satz mehr, weniger Hilfe): Text der Engine', () => {
    const why = ['{0} reps in every set! Add a set at {1} reps.', 12, 8]
    const c = targetCard({ ...base, plan: { policy: 'triple', kind: 'up', weight: 52, why }, last: last([[52, 12], [52, 12]]) })
    expect(c.tone).toBe('up')
    expect(c.head).toEqual(why)
  })
  it('gleiches Gewicht: Wiederholungsziel pro Satz, mit Gewicht', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 10, reps: 13, why: ['…'] }, last: last([[10, 14], [10, 12], [10, 12]], 12) })
    expect(c).toEqual({ tone: 'hold', head: ['Today: {0} reps per set', 13], sub: ['with {0} {1}', '10', 'kg'], extra: null, last: '10 kg · 14 · 12 · 12' })
  })
  it('ein Satz letztes Mal unter dem Ziel: fehlende Wdh. mit Satznummer', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 52, reps: 12, why: ['…'] }, last: last([[52, 12], [52, 12], [52, 11]], 12) })
    expect(c.extra).toEqual(['Last time set {0} was {1} rep short. Get it today.', 3, 1])
  })
  it('mehrere Sätze unter dem Ziel: Anzahl der Sätze', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 52, reps: 13, why: ['…'] }, last: last([[52, 13], [52, 12], [52, 11]], 13) })
    expect(c.extra).toEqual(['Last time {0} sets fell short. Get them today.', 2])
  })
  it('gehalten ohne Wiederholungsziel nach verfehlten Wdh.: die fehlenden holen', () => {
    const c = targetCard({ ...base, plan: { policy: 'linear', kind: 'hold', weight: 52, why: ['Missed reps last time. Same weight again ({0} of {1} to go).', 2, 3] }, last: last([[52, 12], [52, 10]], 12) })
    expect(c.head).toEqual(['Today: get the missing reps'])
    expect(c.sub).toEqual(['with {0} {1}', '52', 'kg'])
  })
  it('Deload: leichter mit Gewicht, Begründung der Engine darunter', () => {
    const why = ['Stuck for {0} sessions. Deload to {1} {2}.', 3, 47, 'kg']
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'deload', weight: 47, reps: 8, why }, last: last([[52, 9], [52, 8]]) })
    expect(c).toMatchObject({ tone: 'down', head: ['Today lighter: {0} {1}', '47', 'kg'], sub: why })
  })
  it('Halteübung: Sekunden halten', () => {
    const c = targetCard({ ...base, mode: 'time', plan: { policy: 'time', kind: 'up', sec: 65, why: ['…'] }, last: { d: '2026-11-05', sets: [{ sec: 60, done: true }], target: { sec: 60 } } })
    expect(c.tone).toBe('up')
    expect(c.head).toEqual(['Today: hold {0} s', 65])
  })
  it('keine Karte: erstes Mal, aus, Cardio, ohne Plan', () => {
    const l = last([[52, 12]])
    expect(targetCard({ ...base, plan: { policy: 'double', kind: 'first', why: ['…'] }, last: null })).toBeNull()
    expect(targetCard({ ...base, plan: { policy: 'off', kind: 'off' }, last: l })).toBeNull()
    expect(targetCard({ ...base, mode: 'cardio', plan: { policy: 'double', kind: 'hold', weight: 0, why: ['…'] }, last: l })).toBeNull()
    expect(targetCard({ ...base, plan: undefined, last: l })).toBeNull()
  })
})

describe('lastText', () => {
  it('ein Gewicht: Gewicht einmal, dann die Wiederholungen', () => {
    expect(lastText(last([[52, 12], [52, 11]]), 'x', 'kg')).toBe('52 kg · 12 · 11')
  })
  it('gemischte Gewichte: jeder Satz für sich', () => {
    expect(lastText(last([[52, 12], [57, 8]]), 'x', 'kg')).toBe('52×12 · 57×8')
  })
  it('ohne letztes Mal null', () => {
    expect(lastText(null, 'x', 'kg')).toBeNull()
  })
})

describe('setDelta', () => {
  const opt = { mode: 'reps', unit: 'kg' }
  it('mehr Gewicht zählt als besser, auch mit weniger Wdh.', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 57, r: 9 }, opt)).toEqual({ sign: 1, text: '+5 kg' })
  })
  it('gleiches Gewicht: Wiederholungen', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 13 }, opt)).toEqual({ sign: 1, text: '+1' })
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 12 }, opt)).toEqual({ sign: 0, text: '=' })
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 10 }, opt)).toEqual({ sign: -1, text: '−2' })
  })
  it('weniger Gewicht', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 47, r: 12 }, opt)).toEqual({ sign: -1, text: '−5 kg' })
  })
  it('Hilfe an der Maschine: weniger Gewicht ist besser', () => {
    expect(setDelta({ w: 30, r: 8 }, { w: 25, r: 8 }, { ...opt, assisted: true })).toEqual({ sign: 1, text: '−5 kg' })
  })
  it('Halteübung: Sekunden', () => {
    expect(setDelta({ sec: 60 }, { sec: 65 }, { mode: 'time', unit: 'kg' })).toEqual({ sign: 1, text: '+5 s' })
  })
  it('kein Vergleich ohne Wdh., ohne letzten Satz, bei Cardio', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 0 }, opt)).toBeNull()
    expect(setDelta(null, { w: 52, r: 12 }, opt)).toBeNull()
    expect(setDelta({ min: 10 }, { min: 12 }, { mode: 'cardio', unit: 'kg' })).toBeNull()
  })
})

describe('prevSetAt', () => {
  const l = last([[52, 12], [52, 11]])
  it('Arbeitssatz i gegen Arbeitssatz i, Aufwärmsätze zählen nicht', () => {
    const sets = [{ w: 30, r: 10, warmup: true }, { w: 52, r: 12 }, { w: 52, r: 12 }, { w: 52, r: 12 }]
    expect(prevSetAt(l, sets, 0)).toBeNull()
    expect(prevSetAt(l, sets, 1)).toBe(l.sets[0])
    expect(prevSetAt(l, sets, 2)).toBe(l.sets[1])
    expect(prevSetAt(l, sets, 3)).toBeNull()
  })
  it('ohne letztes Mal null', () => {
    expect(prevSetAt(null, [{ w: 52, r: 12 }], 0)).toBeNull()
  })
})

describe('progressCount', () => {
  it('zählt Übungen mit letztem Mal, gesteigert mit Plus', () => {
    const rows = [
      { id: 'a', today: [{ w: 57, r: 9 }], last: [{ w: 52, r: 12 }], trend: 1 },
      { id: 'b', today: [{ w: 10, r: 13 }, { w: 10, r: 13 }], last: [{ w: 10, r: 12 }, { w: 10, r: 11 }], trend: 1 },
      { id: 'c', today: [{ w: 40, r: 10 }], last: [{ w: 40, r: 10 }], trend: 0 },
      { id: 'd', today: [{ w: 20, r: 10 }], last: null, trend: null },
    ]
    expect(progressCount(rows, 'kg')).toEqual({ up: [{ id: 'a', plus: '+5 kg' }, { id: 'b', plus: '+3 reps' }], of: 3 })
  })
})
