// @vitest-environment happy-dom
// Thilos Fork: Zielkarte und Satzvergleich im Training (thilo/docs/2026-11-10-progression-push.md).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { EXDB, isAssisted } from '../lib/exercises.js'
import { setThiloRules } from '../lib/thilo-rules.js'
import { haptic } from '../lib/thilo-haptics.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../lib/thilo-haptics.js', () => ({ haptic: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['body weight', 'band', 'resistance band', 'dumbbell'].includes(e.eq) && !isAssisted(e.id)).id
let root, container

function mount() {
  const S = JSON.parse(JSON.stringify(DEF))
  S.unit = 'kg'
  S.workouts = [{
    id: 'w1', d: '2026-11-05', start: Date.UTC(2026, 10, 5, 17), end: Date.UTC(2026, 10, 5, 18),
    entries: [{ id: LIFT, target: { sets: 3, reps: 12 }, sets: [12, 12, 12].map(r => ({ w: 52, r, done: true })) }],
  }]
  S.active = {
    id: 'thilo-target-test', d: '2026-11-10', start: Date.now(), routineId: null, name: 'Oberkörper A', bw: null, cur: 0,
    entries: [{
      id: LIFT, target: { sets: 3, reps: 8, weight: 57 }, planned: { sets: 3, reps: 12, repsMin: 8 },
      plan: { policy: 'double', kind: 'up', weight: 57, reps: 8, why: ['Top of the rep range in every set. {0} {1} more, back to {2} reps.', 5, 'kg', 8] },
      sets: [0, 1, 2].map(() => ({ w: 57, r: 8, done: false })),
    }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
beforeEach(() => { setThiloRules(true); vi.mocked(haptic).mockClear() })
afterEach(() => {
  if (root) { act(() => root.unmount()); container.remove(); root = null }
  setThiloRules(false)
})

describe('Zielkarte und Satzvergleich', () => {
  it('Karte mit Stufe nach oben und letztem Mal, je Satz das letzte Mal, statt der alten Hinweiszeile', () => {
    mount()
    const card = container.querySelector('[data-testid="thilo-target"]')
    expect(card.textContent).toContain('Today: 1 step up')
    expect(card.textContent).toContain('≈ 57 kg · 8–12 reps')
    expect(card.textContent).toContain('Last time: 52 kg · 12 · 12 · 12')
    expect(container.querySelector('.progline')).toBe(null)
    const cmp = [...container.querySelectorAll('[data-testid="thilo-cmp"]')]
    expect(cmp).toHaveLength(3)
    expect(cmp[0].textContent).toBe('last time 52×12')
  })
  it('abgehakter Satz mit mehr Gewicht: Chip „+5 kg“ und Erfolgs-Impuls', () => {
    mount()
    act(() => container.querySelector('[aria-label="Set 1 done"]').click())
    const chip = container.querySelector('[data-testid="thilo-cmp"] .d')
    expect(chip.textContent).toBe('+5 kg')
    expect(chip.className).toContain('up')
    expect(haptic).toHaveBeenCalledWith('success')
  })
})
