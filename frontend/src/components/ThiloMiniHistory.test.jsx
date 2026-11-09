// @vitest-environment happy-dom
// Thilos Fork: der Mini-Verlauf im Training (components/ThiloMiniHistory.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThiloMiniHistory, { MINI_SESSIONS } from './ThiloMiniHistory.jsx'
import { EXDB, isAssisted } from '../lib/exercises.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const workout = (i, w) => ({
  id: 'w' + i, d: `2026-10-${String(10 + i).padStart(2, '0')}`, start: Date.UTC(2026, 9, 10 + i), end: Date.UTC(2026, 9, 10 + i, 1),
  entries: [{ id: LIFT, target: { sets: 2, reps: 12 }, sets: [{ w, r: 12, done: true }, { w, r: 10, done: true }] }],
})

let container, root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = el => act(() => root.render(el))

describe('ThiloMiniHistory', () => {
  it('ohne Session nichts', () => {
    render(<ThiloMiniHistory S={{ unit: 'kg', workouts: [] }} exId={LIFT} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
  it('die letzten Sessions mit Datum und Sätzen, die neueste zuerst; der Knopf öffnet den Verlauf', () => {
    const onOpen = vi.fn()
    const workouts = [25, 27.5, 27.5, 30, 30, 32.5].map((w, i) => workout(i, w))
    render(<ThiloMiniHistory S={{ unit: 'kg', workouts }} exId={LIFT} onOpen={onOpen} />)
    const rows = container.querySelectorAll('.thilo-hist-row')
    expect(rows).toHaveLength(MINI_SESSIONS)
    expect(rows[0].querySelector('time').getAttribute('datetime')).toBe('2026-10-15')
    expect(rows[0].textContent).toContain('32.5')
    expect(container.querySelector('svg')).toBeTruthy()
    act(() => container.querySelector('.thilo-hist-more').click())
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
