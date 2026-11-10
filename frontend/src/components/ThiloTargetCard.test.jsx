// @vitest-environment happy-dom
// Thilos Fork: die Zielkarte im Training (components/ThiloTargetCard.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThiloTargetCard from './ThiloTargetCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

describe('ThiloTargetCard', () => {
  it('ohne Modell nichts', () => {
    render(<ThiloTargetCard model={null} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
  it('Überschrift, Zeilen und letztes Mal; ein Tipp öffnet die Einstellungen', () => {
    const onOpen = vi.fn()
    const model = { tone: 'up', head: ['Today: 1 step up'], sub: ['≈ {0} {1} · {2}–{3} reps', '57', 'kg', 8, 12], extra: null, last: '52 kg · 12 · 12 · 12' }
    render(<ThiloTargetCard model={model} onOpen={onOpen} />)
    const card = container.querySelector('[data-testid="thilo-target"]')
    expect(card.className).toContain('up')
    expect(card.textContent).toContain('Today: 1 step up')
    expect(card.textContent).toContain('≈ 57 kg · 8–12 reps')
    expect(card.textContent).toContain('52 kg · 12 · 12 · 12')
    act(() => card.click())
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
