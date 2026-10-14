// Thilos Fork: die Anbindung des laufenden Trainings an das iPhone (TrainingLivePlugin).
// Geprüft wird, welche Aufrufe bei Trainingsstart, Satz-/Übungswechsel, Pause und Trainingsende
// beim Plugin ankommen, dass Web und Android nichts aufrufen und dass Fehler einmal in der Konsole
// landen statt verschluckt zu werden.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'ios', calls: [], fail: null, registerPlugin: null }
})

// Wie der Proxy aus registerPlugin(): jede Eigenschaft ist eine native Methode, `then` eingeschlossen,
// und die kommt nie zurück. Darf also nie Ergebnis eines Promise werden.
const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    return args => {
      h.calls.push([String(prop), args])
      if (h.fail) return Promise.reject(new Error(h.fail))
      return Promise.resolve({})
    }
  },
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: (...args) => h.registerPlugin(...args),
}))

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }
const methods = () => h.calls.map(c => c[0])
const load = () => import('./thilo-ios-training.js')

const entry = (id, sets) => ({ id, sets })
const workout = (over = {}) => ({
  id: 'w1', start: 1_700_000_000_000, name: 'Push', cur: 0,
  entries: [entry('bench', [{ done: true }, { done: false }, { done: false }]), entry('ohp', [{}, {}])],
  ...over,
})
const nameOf = id => ({ bench: 'Bankdrücken', ohp: 'Schulterdrücken' })[id] || id

beforeEach(() => {
  vi.resetModules()
  h.platform = 'ios'
  h.calls = []
  h.fail = null
  h.registerPlugin = vi.fn(() => pluginProxy())
  globalThis.Capacitor = { getPlatform: () => h.platform }
})
afterAll(() => {
  delete globalThis.Capacitor
  vi.unstubAllEnvs()
})

describe('trainingSnapshot', () => {
  it('liest Name, Start, aktuelle Übung und Satz x von y', async () => {
    const { trainingSnapshot } = await load()
    expect(trainingSnapshot(workout(), nameOf)).toEqual({ name: 'Push', startedAt: 1_700_000_000_000, exercise: 'Bankdrücken', setNo: 2, setCount: 3 })
  })
  it('bleibt bei y, wenn alle Sätze erledigt sind', async () => {
    const { trainingSnapshot } = await load()
    const A = workout({ entries: [entry('bench', [{ done: true }, { done: true }])] })
    expect(trainingSnapshot(A, nameOf)).toMatchObject({ setNo: 2, setCount: 2 })
  })
  it('folgt der aktuellen Übung (cur)', async () => {
    const { trainingSnapshot } = await load()
    expect(trainingSnapshot(workout({ cur: 1 }), nameOf)).toMatchObject({ exercise: 'Schulterdrücken', setNo: 1, setCount: 2 })
  })
  it('kein Training: nichts, ein nachgetragenes oder bearbeitetes Training zählt nicht', async () => {
    const { trainingSnapshot } = await load()
    expect(trainingSnapshot(null, nameOf)).toBeNull()
    expect(trainingSnapshot(workout({ backfill: { durationMin: 60 } }), nameOf)).toBeNull()
    expect(trainingSnapshot(workout({ editingWorkoutId: 'x' }), nameOf)).toBeNull()
  })
  it('hält ein leeres Training aus', async () => {
    const { trainingSnapshot } = await load()
    expect(trainingSnapshot(workout({ entries: [] }), nameOf)).toMatchObject({ exercise: '', setNo: 0, setCount: 0 })
  })
})

describe('watchTraining', () => {
  const store = S => create(() => ({ S }))

  it('ohne Training beim Start räumt es eine liegengebliebene Aktivität weg', async () => {
    const { watchTraining } = await load()
    watchTraining(store({ active: null }), { nameOf })
    await settle()
    expect(methods()).toEqual(['end'])
  })

  it('Trainingsstart, Satzwechsel, Übungswechsel, Ende', async () => {
    const { watchTraining } = await load()
    const st = store({ active: null, sound: true })
    watchTraining(st, { nameOf })
    await settle()
    h.calls = []

    st.setState({ S: { active: workout(), sound: true } })
    await settle()
    expect(h.calls).toEqual([['start', { name: 'Push', startedAt: 1_700_000_000_000, exercise: 'Bankdrücken', setNo: 2, setCount: 3 }]])

    // Eine Änderung, die am Bild nichts ändert (anderes Feld), ruft nichts auf.
    st.setState({ S: { active: { ...workout(), note: 'x' }, sound: true } })
    await settle()
    expect(h.calls.length).toBe(1)

    const two = workout()
    two.entries[0].sets[1] = { done: true }
    st.setState({ S: { active: two, sound: true } })
    await settle()
    expect(h.calls[1]).toEqual(['update', { name: 'Push', startedAt: 1_700_000_000_000, exercise: 'Bankdrücken', setNo: 3, setCount: 3 }])

    st.setState({ S: { active: { ...two, cur: 1 }, sound: true } })
    await settle()
    expect(h.calls[2]).toEqual(['update', expect.objectContaining({ exercise: 'Schulterdrücken', setNo: 1, setCount: 2 })])

    st.setState({ S: { active: null, sound: true } })
    await settle()
    expect(h.calls[3]).toEqual(['end', {}])
  })

  it('ein laufendes Training beim App-Start (nach Neustart) startet die Aktivität wieder', async () => {
    const { watchTraining } = await load()
    watchTraining(store({ active: workout() }), { nameOf })
    await settle()
    expect(methods()).toEqual(['start'])
  })
})

describe('Pause', () => {
  it('Start, Halt und Ende gehen mit Ansagetext, Ton-Schalter und Sprache ans Plugin', async () => {
    const { iosRestStart, iosRestHold, iosRestStop } = await load()
    iosRestStart(1_700_000_090_000, { totalSec: 90, title: 'Pause', doneTitle: 'Pause vorbei. Nächster Satz!', sound: true, lang: 'de' })
    iosRestHold(42, 90, { title: 'Pause', doneTitle: 'Pause vorbei. Nächster Satz!' })
    iosRestStop()
    await settle()
    expect(h.calls).toEqual([
      ['rest', { endsAt: 1_700_000_090_000, totalSec: 90, title: 'Pause', doneTitle: 'Pause vorbei. Nächster Satz!', speech: 'Pause vorbei. Nächster Satz!', sound: true, lang: 'de' }],
      ['hold', { leftSec: 42, totalSec: 90, title: 'Pause', doneTitle: 'Pause vorbei. Nächster Satz!' }],
      ['restStop', {}],
    ])
  })
  it('Ton aus: sound false', async () => {
    const { iosRestStart } = await load()
    iosRestStart(1, { totalSec: 10, title: 'Seite wechseln', doneTitle: 'Seite wechseln', sound: 0 })
    await settle()
    expect(h.calls[0][1]).toMatchObject({ sound: false, speech: 'Seite wechseln' })
  })
})

describe('iosSpeaksRestEnd', () => {
  it('nur in der iPhone-App, solange das Plugin nicht gescheitert ist', async () => {
    const { iosSpeaksRestEnd, iosRestStop } = await load()
    expect(iosSpeaksRestEnd()).toBe(true)
    h.fail = 'TrainingLive plugin is not implemented on ios'
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    iosRestStop()
    await settle()
    expect(iosSpeaksRestEnd()).toBe(false)
    err.mockRestore()
  })
  it('nicht unter Android', async () => {
    h.platform = 'android'
    const { iosSpeaksRestEnd } = await load()
    expect(iosSpeaksRestEnd()).toBe(false)
  })
})

describe('Fehler', () => {
  it('werden einmal in der Konsole gemeldet, nicht verschluckt und nicht wiederholt', async () => {
    h.fail = 'boom'
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { iosRestStop, iosRestHold } = await load()
    iosRestStop()
    iosRestHold(5, 10)
    iosRestStop()
    await settle()
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0].join(' '))).toMatch(/TrainingLive.*boom/)
    err.mockRestore()
  })
})

describe('Web und Android', () => {
  it('Android: kein Aufruf', async () => {
    h.platform = 'android'
    const { iosRestStart, iosRestStop, watchTraining } = await load()
    watchTraining(create(() => ({ S: { active: workout() } })), { nameOf })
    iosRestStart(1, { totalSec: 10 })
    iosRestStop()
    await settle()
    expect(h.calls).toEqual([])
    expect(h.registerPlugin).not.toHaveBeenCalled()
  })
  it('Web-Build: kein Aufruf, Capacitor wird nicht einmal geladen', async () => {
    vi.stubEnv('VITE_MOBILE', '')
    try {
      const { iosRestStart, iosRestStop, watchTraining, iosSpeaksRestEnd } = await load()
      watchTraining(create(() => ({ S: { active: workout() } })), { nameOf })
      iosRestStart(1, { totalSec: 10 })
      iosRestStop()
      await settle()
      expect(h.calls).toEqual([])
      expect(h.registerPlugin).not.toHaveBeenCalled()
      expect(iosSpeaksRestEnd()).toBe(false)
    } finally {
      vi.stubEnv('VITE_MOBILE', '1')
    }
  })
})
