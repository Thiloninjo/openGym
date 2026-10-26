import { describe, expect, it } from 'vitest'
import { applyCoachLive, coachConfig, fullyDone } from './coach-live.js'
import { buildSwapReplacement } from './swap-replacement.js'
import { mergeStates, stampEdits } from './sync-merge.js'

// 0334 dumbbell lateral raise, 0584 lever lateral raise, 0025 barbell bench press, 0027 barbell bent over row.
const NAMES = { '0334': 'Seitheben mit Kurzhanteln', '0584': 'Seitheben an der Hebelmaschine', '0025': 'Bankdrücken', '0027': 'Rudern' }
const nameOf = id => NAMES[id] || id
const built = []
const build = (current, exId, cfg) => {
  built.push({ current, exId, cfg })
  return { id: exId, target: { ...cfg, id: exId }, sets: Array.from({ length: cfg.sets }, () => ({ w: 20, r: cfg.reps, done: false })) }
}
const helpers = { build, nameOf }

const T = 1_800_000_000_000
const entry = (id, { sg, done = [], sets = 3, rid } = {}) => ({
  id,
  ...(sg ? { sg } : {}),
  ...(rid ? { rid } : {}),
  target: { mode: 'reps', sets, reps: 12, weight: 10 },
  planned: { sets, reps: 12 },
  sets: Array.from({ length: sets }, (_, i) => ({ w: 10, r: 12, done: done.includes(i) })),
})
const workout = (entries, cur = 0) => ({ id: 'a1', d: '2026-10-26', start: T - 3_600_000, cur, entries })
const live = (ops, id = 'L1', ts = T) => ({ id, ts, ops })

describe('applyCoachLive', () => {
  it('kein Auftrag oder schon erledigt: nichts ändert sich', () => {
    const a = workout([entry('0334')])
    expect(applyCoachLive(a, null, 'X', helpers)).toEqual({ active: a, notices: [], doneId: 'X', inserted: [] })
    expect(applyCoachLive(a, undefined, null, helpers).doneId).toBe(null)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), 'L1', helpers)
    expect(r.active).toBe(a)
    expect(r.notices).toEqual([])
    expect(r.doneId).toBe('L1')
  })

  it('kein Training: der Auftrag verfällt und wird als erledigt gemerkt', () => {
    const r = applyCoachLive(null, live([{ exId: '0334', newExId: '0584' }]), 'L0', helpers)
    expect(r).toEqual({ active: null, notices: [], doneId: 'L1', inserted: [] })
  })

  it('ein Training, das erst nach dem Auftrag begann, oder eine Bearbeitung: verfällt', () => {
    const later = { ...workout([entry('0334')]), start: T + 1000 }
    let r = applyCoachLive(later, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active).toBe(later)
    expect(r.doneId).toBe('L1')
    const editing = { ...workout([entry('0334')]), editingWorkoutId: 'w9' }
    r = applyCoachLive(editing, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active).toBe(editing)
    expect(r.doneId).toBe('L1')
  })

  it('tauscht an Ort und Stelle, mit Satz-Schema des Platzes, und sagt es', () => {
    const a = workout([entry('0025', { done: [0, 1, 2] }), entry('0334', { sets: 4 }), entry('0027')], 0)
    const before = JSON.stringify(a)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(JSON.stringify(a)).toBe(before)   // Eingabe unverändert
    expect(r.active.entries.map(e => e.id)).toEqual(['0025', '0584', '0027'])
    expect(r.active.entries[1].target).toMatchObject({ sets: 4, reps: 12, mode: 'reps' })
    expect(r.active.cur).toBe(0)
    expect(r.active.coachLiveId).toBe('L1')
    expect(r.notices).toEqual(['Coach: Seitheben mit Kurzhanteln → Seitheben an der Hebelmaschine'])
    expect(r.doneId).toBe('L1')
    expect(r.inserted).toEqual([])
  })

  it('cfg überschreibt Sätze, Wiederholungen und Gewicht; die Notiz steht im Hinweis', () => {
    const a = workout([entry('0334')])
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584', cfg: { sets: 2, reps: 15, weight: 30 }, note: 'KH belegt' }]), null, helpers)
    const e = r.active.entries[0]
    expect(e.target).toMatchObject({ sets: 2, reps: 15, weight: 30 })
    expect(e.sets.map(s => s.w)).toEqual([30, 30])
    expect(r.notices[0]).toBe('Coach: Seitheben mit Kurzhanteln → Seitheben an der Hebelmaschine (KH belegt)')
  })

  it('doppelte Übung: der erste noch nicht ganz erledigte Eintrag', () => {
    const a = workout([entry('0334', { done: [0, 1, 2] }), entry('0334'), entry('0334')], 1)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0334', '0584', '0334'])
    expect(r.active.cur).toBe(1)
  })

  it('schon erledigte Sätze: der Ersatz kommt daneben, die erledigten bleiben', () => {
    const a = workout([entry('0334', { done: [0] }), entry('0027')], 1)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0334', '0584', '0027'])
    expect(r.active.entries[0].sets[0].done).toBe(true)
    expect(r.inserted).toEqual([1])
    // die Auswahl stand auf 0027 und bleibt dort, eins weiter geschoben
    expect(r.active.cur).toBe(2)
  })

  it('wer gerade an der getauschten Übung ist, landet auf dem Ersatz', () => {
    const a = workout([entry('0025'), entry('0334', { done: [0] })], 1)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0025', '0334', '0584'])
    expect(r.active.cur).toBe(2)
  })

  it('Supersatz: der Ersatz bleibt in der Gruppe', () => {
    const a = workout([entry('0025', { sg: 'g1' }), entry('0334', { sg: 'g1', done: [0] }), entry('0027')], 0)
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(r.active.entries.map(e => [e.id, e.sg])).toEqual([['0025', 'g1'], ['0334', 'g1'], ['0584', 'g1'], ['0027', undefined]])
    // unerledigt im Supersatz: an Ort und Stelle, die Gruppe bleibt
    const b = workout([entry('0025', { sg: 'g1' }), entry('0334', { sg: 'g1' })], 0)
    const s = applyCoachLive(b, live([{ exId: '0334', newExId: '0584' }]), null, helpers)
    expect(s.active.entries.map(e => [e.id, e.sg])).toEqual([['0025', 'g1'], ['0584', 'g1']])
  })

  it('Übung fehlt oder ist schon erledigt: Hinweis, sonst nichts', () => {
    const a = workout([entry('0025'), entry('0027', { done: [0, 1, 2] })])
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }, { exId: '0027', newExId: '0584' }]), null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0025', '0027'])
    expect(r.notices).toEqual(['Coach: Seitheben mit Kurzhanteln nicht im Training gefunden', 'Coach: Rudern ist schon erledigt'])
    expect(r.doneId).toBe('L1')
  })

  it('derselbe Auftrag zweimal: beim zweiten Mal passiert nichts', () => {
    const a = workout([entry('0334', { done: [0] }), entry('0027')])
    const order = live([{ exId: '0334', newExId: '0584' }])
    const first = applyCoachLive(a, order, null, helpers)
    expect(first.active.entries).toHaveLength(3)
    const again = applyCoachLive(first.active, order, first.doneId, helpers)
    expect(again.active).toBe(first.active)
    expect(again.notices).toEqual([])
    // auch wenn die erledigte ID auf dem Gerät verloren ging: am Training vermerkt
    const lost = applyCoachLive(first.active, order, null, helpers)
    expect(lost.active).toBe(first.active)
    expect(lost.notices).toEqual([])
    expect(lost.doneId).toBe('L1')
  })

  it('dieselbe Übung zweimal im Auftrag: tauscht nacheinander zwei Einträge', () => {
    const a = workout([entry('0334'), entry('0027'), entry('0334')])
    const r = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }, { exId: '0334', newExId: '0025' }]), null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0584', '0027', '0025'])
    expect(r.notices).toHaveLength(2)
  })

  it('ein neuer Auftrag nach einem erledigten wird angewendet', () => {
    const a = workout([entry('0334'), entry('0027')])
    const one = applyCoachLive(a, live([{ exId: '0334', newExId: '0584' }], 'L1'), null, helpers)
    const two = applyCoachLive(one.active, live([{ exId: '0027', newExId: '0025' }], 'L2', T + 1), one.doneId, helpers)
    expect(two.active.entries.map(e => e.id)).toEqual(['0584', '0025'])
    expect(two.doneId).toBe('L2')
  })

  it('kaputte ops werden übergangen', () => {
    const a = workout([entry('0334')])
    const r = applyCoachLive(a, { id: 'L1', ts: T, ops: [null, { exId: 5 }, { exId: '0334' }] }, null, helpers)
    expect(r.active.entries.map(e => e.id)).toEqual(['0334'])
    expect(r.notices).toEqual([])
    expect(r.doneId).toBe('L1')
  })
})

describe('fullyDone / coachConfig', () => {
  it('fullyDone: alle Sätze, auch je Seite', () => {
    expect(fullyDone({ sets: [] })).toBe(false)
    expect(fullyDone({ sets: [{ done: true }, { done: true }] })).toBe(true)
    expect(fullyDone({ sets: [{ done: true }, { done: false }] })).toBe(false)
    expect(fullyDone({ sets: [{ sides: { L: { done: true }, R: { done: false } } }] })).toBe(false)
  })
  it('coachConfig: Standard der neuen Übung, Schema des Platzes, cfg darüber', () => {
    const cur = { id: '0334', target: { mode: 'reps', sets: 4, reps: 12, repsMin: 10, weight: 10 }, planned: { sets: 4, reps: 12, repsMin: 10 } }
    expect(coachConfig(cur, '0584')).toMatchObject({ sets: 4, reps: 12, repsMin: 10, weight: 0, mode: 'reps' })
    expect(coachConfig(cur, '0584', { reps: 8, repsMin: null, weight: 25 })).toMatchObject({ sets: 4, reps: 8, weight: 25 })
    expect(coachConfig(cur, '0584', { reps: 8, repsMin: null }).repsMin).toBeUndefined()
    expect(coachConfig(cur, '0584', { reps: 10 }).repsMin).toBeUndefined()   // 10 ≥ 10: kein Bereich mehr
  })
})

describe('mit dem echten Aufbau des manuellen Tauschs', () => {
  it('baut den Ersatz über buildSwapReplacement', () => {
    const st = { unit: 'kg', workouts: [], routines: [], bodyweight: [], customEx: [], exWeights: {} }
    st.active = workout([entry('0334'), entry('0027')])
    const r = applyCoachLive(st.active, live([{ exId: '0334', newExId: '0584', cfg: { weight: 35 } }]), null, {
      build: (current, exId, cfg) => buildSwapReplacement(st, current, exId, cfg), nameOf,
    })
    const e = r.active.entries[0]
    expect(e.id).toBe('0584')
    expect(e.target).toMatchObject({ sets: 3, reps: 12, weight: 35 })
    expect(e.sets.filter(s => !s.done).length).toBeGreaterThan(0)
    expect(e.sets.at(-1).w).toBe(35)
  })
})

// Sync: den Auftrag schreibt nur der Server (api/thilo-coach.js keepCoachLive) und stempelt ihn
// (edited.coachLive). Im Merge der App gewinnt der gestempelte Stand des Servers.
describe('coachLive im Sync der App', () => {
  const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [], restSec: 90 })
  it('ein neuerer Server-Auftrag gewinnt gegen eine lokale Änderung mit neuerem _ts', () => {
    const server = { ...base(), coachLive: live([{ exId: '0334', newExId: '0584' }], 'L2', T + 5), edited: { coachLive: T + 5 } }
    const local = { ...base(), _ts: T + 50, restSec: 60, coachLive: live([], 'L1'), edited: { restSec: T + 50, coachLive: T } }
    for (const m of [mergeStates(local, server), mergeStates(server, local)]) {
      expect(m.coachLive.id).toBe('L2')
      expect(m.restSec).toBe(60)
    }
  })
  it('ein Gerät, das den Auftrag noch nicht hatte, bekommt ihn; eine lokale Änderung stempelt ihn nicht', () => {
    const server = { ...base(), coachLive: live([], 'L2'), edited: { coachLive: T + 5 } }
    const local = { ...base(), _ts: T + 50, restSec: 60, edited: { restSec: T + 50 } }
    expect(mergeStates(local, server).coachLive.id).toBe('L2')
    const prev = { ...base(), coachLive: live([], 'L2') }
    const next = { ...prev, restSec: 75 }
    stampEdits(prev, next, T + 99)
    expect(next.edited.coachLive).toBeUndefined()
  })
})
