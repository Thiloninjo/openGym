// Thilos Fork: die eigenen Progressionsregeln (lib/thilo-rules.js). Ohne Schalter rechnet alles wie
// upstream; die Tests dort laufen deshalb unverändert.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextPrescription, policyFor, readSession, workingWeight } from './progression.js'
import { normalizeRepRange } from './rep-range.js'
import { setThiloRules } from './thilo-rules.js'
import { EXDB, isAssisted } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id

// Eine Übung in einer Routine: 3 × 12, ohne eigene Regel.
const routine = { id: 'r1', ex: [] }
const cfg = { id: LIFT, sets: 3, reps: 12, weight: 30 }
const planned = { sets: 3, reps: 12, weight: 30 }
const set = (w, r, done = true) => ({ w, r, done })
// Eine Session: Ziel (wie die App es gespeichert hat) und die Sätze.
const session = (d, target, sets) => ({ d, entries: [{ id: LIFT, rid: 'r1', planned, target: { ...cfg, ...target }, sets }] })
const state = (...workouts) => ({ unit: 'kg', workouts })

beforeEach(() => setThiloRules(true))
afterEach(() => setThiloRules(false))

describe('Schalter', () => {
  it('ohne Schalter bleibt alles wie im Original', () => {
    setThiloRules(false)
    expect(policyFor(cfg, routine, 'reps')).toBe('linear')
    expect(normalizeRepRange(12)).toEqual({ reps: 12, repsMin: 10 })
    expect(readSession({ id: LIFT, target: cfg, sets: [set(30, 12), set(30, 12), set(50, 3)] }).weight).toBe(50)
  })
})

describe('Regel und Bereich', () => {
  it('ohne eigene Regel oder mit „linear“: doppelte Progression', () => {
    expect(policyFor(cfg, routine, 'reps')).toBe('double')
    expect(policyFor({ ...cfg, prog: 'linear' }, routine, 'reps')).toBe('double')
    expect(policyFor({ ...cfg, prog: 'greyskull' }, routine, 'reps')).toBe('greyskull')
    expect(policyFor({ ...cfg, prog: 'off' }, routine, 'reps')).toBe('off')
  })
  it('der Plan ist das obere Ende: 12 → 8–12; ein eigenes Minimum gilt', () => {
    expect(normalizeRepRange(12)).toEqual({ reps: 12, repsMin: 8 })
    expect(normalizeRepRange(12, 10)).toEqual({ reps: 12, repsMin: 10 })
  })
})

describe('Arbeitsgewicht', () => {
  it('12×30, 12×30, 3×50: zählt 30, der Versuch mit 50 nicht', () => {
    const s = readSession({ id: LIFT, target: cfg, sets: [set(30, 12), set(30, 12), set(50, 3)] })
    expect(s.weight).toBe(30)
    expect(s.reps).toEqual([12, 12])
    expect(s.ok).toBe(false) // bei 30 nur zwei Sätze
  })
  it('keiner schafft das Ziel: das Gewicht der meisten Sätze', () => {
    expect(workingWeight([set(30, 10), set(30, 9), set(32.5, 6)], cfg, 12)).toBe(30)
  })
  it('ohne Last (Körpergewicht) entscheidet das Original', () => {
    expect(workingWeight([set(0, 12)], cfg, 12)).toBeNull()
  })
})

describe('nächste Session', () => {
  it('nach 12×30, 12×30, 3×50 steht 30 da, nicht 50', () => {
    const st = state(session('2026-11-03', {}, [set(30, 12), set(30, 12), set(50, 3)]))
    const p = nextPrescription(st, cfg, routine)
    expect(p.weight).toBe(30)
    expect(p.reps).toBe(12)
  })
  it('alle Sätze oben im Bereich: ein Schritt mehr, zurück auf 8', () => {
    const st = state(session('2026-11-03', {}, [set(30, 12), set(30, 12), set(30, 12)]))
    const p = nextPrescription(st, cfg, routine)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(32.5)
    expect(p.reps).toBe(8)
  })
  it('im Bereich: gleiches Gewicht, eine Wiederholung mehr', () => {
    const st = state(session('2026-11-03', { weight: 32.5, reps: 8 }, [set(32.5, 9), set(32.5, 8), set(32.5, 8)]))
    const p = nextPrescription(st, cfg, routine)
    expect(p.weight).toBe(32.5)
    expect(p.reps).toBe(9)
  })
  it('schlechter Tag: das Ziel sinkt nicht', () => {
    const st = state(
      session('2026-11-01', { weight: 32.5, reps: 9 }, [set(32.5, 10), set(32.5, 10), set(32.5, 10)]),
      session('2026-11-03', { weight: 32.5, reps: 11 }, [set(32.5, 8), set(32.5, 7), set(32.5, 7)]),
    )
    const p = nextPrescription(st, cfg, routine)
    expect(p.weight).toBe(32.5)
    expect(p.reps).toBe(11)
  })
  it('schlechter Tag mit weniger Gewicht als vorgegeben: das Gewicht sinkt nicht', () => {
    const st = state(session('2026-11-03', { weight: 32.5, reps: 10 }, [set(30, 10), set(30, 10), set(30, 10)]))
    const p = nextPrescription(st, cfg, routine)
    expect(p.weight).toBe(32.5)
    expect(p.reps).toBe(10)
  })
})
