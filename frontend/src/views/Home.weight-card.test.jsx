// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'
import { weighInsSheet } from '../sheets.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = (showWeightCard, bodyweight = []) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight, dayPlan: {}, week: {}, active: null, showWeightCard },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const weightHeading = () => [...host.querySelectorAll('h2')].find(el => el.textContent === 'Body weight')

describe('Home body-weight card preference', () => {
  it('shows the card for legacy profiles without the preference', () => {
    mountWith(undefined)
    expect(weightHeading()).toBeTruthy()
  })

  it('shows the card when enabled', () => {
    mountWith(true)
    expect(weightHeading()).toBeTruthy()
  })

  it('hides only the Home card when disabled', () => {
    mountWith(false)
    expect(weightHeading()).toBeFalsy()
  })

  // Thilos Fork: no Log button any more; the weigh-in history stays reachable from the card.
  it('has no Log button, shows the Apple Health hint when empty, and opens the history once there are weigh-ins', () => {
    mountWith(true)
    const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(buttons()).not.toContain('Log')
    expect(host.textContent).toContain('Comes automatically from Apple Health')
    mountWith(true, [{ d: '2026-09-01', w: 81, t: 1 }])
    expect(buttons()).not.toContain('Log')
    const all = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'All weigh-ins')
    expect(all).toBeTruthy()
    act(() => { all.click() })
    expect(weighInsSheet).toHaveBeenCalledTimes(1)
  })
})