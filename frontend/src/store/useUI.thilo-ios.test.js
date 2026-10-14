// @vitest-environment happy-dom
// Thilos Fork: in der iPhone-App sagt die native Seite das Pausenende an (TrainingLivePlugin), der
// Ton der Seite bleibt dann stumm. Pausenstart, -halt und -ende gehen an lib/thilo-ios-training.js,
// das laufende Training wird beobachtet.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ speaks: true }))
vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(false)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(),
  toneNative: vi.fn(() => Promise.resolve(false)),
}))
vi.mock('../lib/thilo-ios-training.js', () => ({
  iosRestStart: vi.fn(),
  iosRestHold: vi.fn(),
  iosRestStop: vi.fn(),
  iosSpeaksRestEnd: vi.fn(() => h.speaks),
  watchTraining: vi.fn(() => () => {}),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { toneNative } from '../lib/rest-alert.js'
import { chime } from '../lib/sound.js'
import { iosRestStart, iosRestHold, iosRestStop, watchTraining } from '../lib/thilo-ios-training.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, sound: true, timerFlash: false }, user: null })
  useUI.setState({ timer: null })
  for (const f of [toneNative, chime, iosRestStart, iosRestHold, iosRestStop]) f.mockClear()
  h.speaks = true
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: original, user: null })
  vi.useRealTimers()
})

describe('iPhone-App: Pause und Training', () => {
  it('beobachtet das Training im Store', () => {
    expect(watchTraining).toHaveBeenCalledWith(useStore, expect.objectContaining({ nameOf: expect.any(Function) }))
  })

  it('Pausenstart, -halt und -ende gehen ans Plugin', () => {
    useUI.getState().startRest(60)
    expect(iosRestStart).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ totalSec: 60, sound: true, lang: expect.any(String) }))
    vi.advanceTimersByTime(10_000)
    useUI.getState().pauseRest()
    expect(iosRestHold).toHaveBeenLastCalledWith(50, 60, expect.any(Object))
    useUI.getState().stopRest()
    expect(iosRestStop).toHaveBeenCalled()
  })

  it('am Pausenende spielt die Seite keinen Ton, die App sagt es an', () => {
    useUI.getState().startRest(5)
    vi.advanceTimersByTime(6_000)
    expect(useUI.getState().timer?.ready).toBe(true)
    expect(toneNative).not.toHaveBeenCalled()
    expect(chime).not.toHaveBeenCalled()
  })

  it('auch nicht beim Seitenwechsel', () => {
    useUI.getState().startRest(3, undefined, { kind: 'switch' })
    vi.advanceTimersByTime(4_000)
    expect(toneNative).not.toHaveBeenCalled()
    expect(chime).not.toHaveBeenCalled()
  })

  it('ohne funktionierendes Plugin kommt der Ton der Seite wieder', async () => {
    h.speaks = false
    useUI.getState().startRest(5)
    vi.advanceTimersByTime(6_000)
    expect(toneNative).toHaveBeenCalled()
  })
})
