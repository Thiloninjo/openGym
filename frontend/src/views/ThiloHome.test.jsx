// @vitest-environment happy-dom
// Thilos Fork: die Startseite im Powerfit-Look (views/ThiloHome.jsx).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { startFlow, calendarSheet, weighInsSheet, dayOverrideSheet } from '../sheets.jsx'
import { todayISO } from '../lib/format.js'
import ThiloHome from './ThiloHome.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }, { id: '0026' }] }]
const everyDay = { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}, user = { name: 'Thilo' }) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], bodyweight: [], active: null, week: everyDay, checkIn: true, ...over },
  user,
}))
const mount = () => act(() => root.render(<ThiloHome />))
const head = () => [...host.querySelectorAll('.th-head > span')].map(s => s.textContent)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const quick = title => [...host.querySelectorAll('.th-q')].find(b => b.querySelector('.th-q-t').textContent === title)

describe('ThiloHome — Kopf und Headline', () => {
  it('grüßt mit Namen und Initialen', () => {
    setS(); mount()
    expect(host.querySelector('.th-hello').textContent).toContain('Hello Thilo')
    expect(host.querySelector('.th-ava').textContent).toBe('T')
  })

  it('Trainingstag: bereit für die Routine', () => {
    setS(); mount()
    expect(head()).toEqual(['Ready for', 'Push'])
  })

  it('Ruhetag: erhol dich', () => {
    setS({ week: {} }); mount()
    expect(head()).toEqual(['Rest day', 'Recover'])
  })

  it('heute erledigt', () => {
    setS({ workouts: [{ id: 'w1', d: todayISO(), routineIds: ['r1'], name: 'Push', start: 0, end: 0, entries: [] }] }); mount()
    expect(head()).toEqual(['Today', 'completed'])
  })

  it('Training läuft', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(head()).toEqual(['Workout', 'running'])
  })
})

describe('ThiloHome — Diese Woche', () => {
  it('der Ring zeigt erledigt von geplant', () => {
    // jeder Tag geplant (7), heute eins erledigt → 14 %
    setS({ workouts: [{ id: 'w1', d: todayISO(), routineIds: ['r1'], name: 'Push', start: 0, end: 45 * 60000, entries: [] }] }); mount()
    expect(host.querySelector('.th-ring').getAttribute('aria-label')).toBe('14% done')
    const stats = [...host.querySelectorAll('.th-stat-v')].map(s => s.textContent)
    expect(stats[0]).toBe('1 / 7')
    expect(stats[2]).toBe('45 min')
  })

  it('ohne Training diese Woche: 0 % und keine Zeit', () => {
    setS(); mount()
    expect(host.querySelector('.th-ring').getAttribute('aria-label')).toBe('0% done')
    expect([...host.querySelectorAll('.th-stat-v')][2].textContent).toBe('–')
  })

  it('ein Tag in der Leiste öffnet den Tagesplan', () => {
    setS(); mount()
    click(host.querySelector('.wday.today'))
    expect(dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })
})

describe('ThiloHome — Schnellzugriff', () => {
  it('Kalender, Check-in und Gewicht', () => {
    setS({ bodyweight: [{ d: todayISO(), w: 72.4 }] }); mount()
    click(quick('Calendar'))
    expect(calendarSheet).toHaveBeenCalled()
    click(quick('Check in'))
    expect(nav).toHaveBeenCalledWith('/checkin')
    expect(quick('Body weight').textContent).toContain('72.4')
    click(quick('Body weight'))
    expect(weighInsSheet).toHaveBeenCalled()
  })

  it('ohne Check-in steht dort der Plan', () => {
    setS({ checkIn: false }); mount()
    expect(quick('Check in')).toBeFalsy()
    click(quick('Plan'))
    expect(nav).toHaveBeenCalledWith('/plan')
  })
})

describe('ThiloHome — Heutiges Training', () => {
  it('startet die Routine des Tages', () => {
    setS(); mount()
    expect(host.querySelector('.th-today-t').textContent).toBe('Push')
    expect(host.querySelector('.th-today-s').textContent).toBe('2 exercises')
    click(host.querySelector('.th-today'))
    expect(startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('ein laufendes Training wird fortgesetzt, nicht neu gestartet', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(host.querySelector('.th-today').classList.contains('live')).toBe(true)
    click(host.querySelector('.th-today'))
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('am Ruhetag lässt sich der Tag planen', () => {
    setS({ week: {} }); mount()
    expect(host.querySelector('.th-today').classList.contains('rest')).toBe(true)
    click(host.querySelector('.th-today'))
    expect(dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })
})
