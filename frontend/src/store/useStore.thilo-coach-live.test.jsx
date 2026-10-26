// @vitest-environment happy-dom

/* Thilos Fork: der Live-Tausch des Coaches (lib/coach-live.js) im Store. Der Server legt `coachLive`
   ab (api/thilo-coach.js); die App wendet ihn nach dem Holen des Stands auf ihr laufendes Training
   an, zeigt einen Hinweis und merkt sich die ID nur auf dem Gerät. Der Server unten antwortet wie
   api/server.js. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ui = vi.hoisted(() => ({ toast: vi.fn(), stopRest: vi.fn(), stopWork: vi.fn(), abandonWork: vi.fn(), timer: null, work: null }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ui, setState: p => Object.assign(ui, p) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const httpError = (status, data) => Object.assign(new Error('HTTP ' + status), { status, data })
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
const T = 1_800_000_000_000
const entry = (id, done = []) => ({ id, target: { mode: 'reps', sets: 3, reps: 12, weight: 10 }, planned: { sets: 3, reps: 12 },
  sets: [0, 1, 2].map(i => ({ w: 10, r: 12, done: done.includes(i) })) })
const running = () => ({ id: 'a1', d: '2026-10-26', start: T - 3_600_000, cur: 1, entries: [entry('0025', [0]), entry('0334')] })
const order = (id = 'L1', ops = [{ exId: '0334', newExId: '0584' }]) => ({ id, ts: T, ops })

let doc, n = 0
const write = state => { const wids = [...(doc?._wids || []), ...(doc?._wid ? [doc._wid] : [])]; doc = { ...clone(state), _rev: (doc?._rev || 0) + 1, _wids: wids, _wid: 'w' + (++n) }; delete doc.active; return doc }
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('gym_owner', USER.id); api.mockReset(); doc = null; n = 0
  ui.toast.mockReset(); ui.stopWork.mockReset(); ui.timer = null; ui.work = null
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
  api.mockImplementation(async (path, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null
    if (path === '/api/data/rev') return { rev: doc?._rev || 0, wid: doc?._wid }
    if ((o.method || 'GET') === 'GET') return { state: clone(doc), rev: doc?._rev || 0 }
    if (body.baseRev != null && (body.baseRev !== (doc?._rev || 0) || (body.baseWid && doc?._wid && body.baseWid !== doc._wid))) throw httpError(409, { error: 'conflict', rev: doc._rev, state: clone(doc) })
    // api/thilo-coach.js keepCoachLive: nur der Hook schreibt coachLive
    const next = clone(body.state)
    if (doc?.coachLive) next.coachLive = clone(doc.coachLive); else delete next.coachLive
    write(next)
    return { ok: true, rev: doc._rev, wid: doc._wid }
  })
})
// Ein Gerät, angemeldet und mit Stand rev 1, mit `active` als laufendem Training.
const signedIn = active => {
  write({ ...clone(DEF), _ts: 100, restSec: 90 })
  useStore.setState({ S: { ...clone(doc), _ts: 100, active }, user: USER, ready: true, sync: { ...fresh } })
  localStorage.setItem('gym_sync', JSON.stringify({ rev: doc._rev, ts: 100, wid: doc._wid }))
}
// Der Coach-Hook: schreibt den Auftrag, vom Server gestempelt.
const hook = live => write({ ...clone(doc), coachLive: live, edited: { ...(doc.edited || {}), coachLive: T } })
const S = () => useStore.getState().S

describe('Live-Tausch des Coaches im Store', () => {
  it('nach dem Pull: getauscht, Hinweis, ID gemerkt; beim nächsten Pull nichts mehr', async () => {
    signedIn(running())
    hook(order())
    await useStore.getState().pullState()
    await tick()
    expect(S().active.entries.map(e => e.id)).toEqual(['0025', '0584'])
    expect(S().active.cur).toBe(1)
    expect(S().coachLive.id).toBe('L1')
    expect(localStorage.getItem('gym_coach_live_done')).toBe('L1')
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/^Coach: .+ → .+/)
    // lokal gespeichert, wie jedes laufende Training
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).active.entries[1].id).toBe('0584')

    write({ ...clone(doc), restSec: 60 })   // ein anderes Gerät ändert etwas
    await useStore.getState().pullState()
    await tick()
    expect(S().restSec).toBe(60)
    expect(S().active.entries.map(e => e.id)).toEqual(['0025', '0584'])
    expect(ui.toast).toHaveBeenCalledTimes(1)
  })

  it('mit einer lokalen Änderung (Merge): der Auftrag kommt an und wird angewendet', async () => {
    signedIn(running())
    useStore.getState().update(s => { s.restSec = 75 })
    hook(order())
    await useStore.getState().pullState()
    await tick()
    expect(S().active.entries.map(e => e.id)).toEqual(['0025', '0584'])
    expect(S().restSec).toBe(75)
    expect(doc.coachLive.id).toBe('L1')
    expect(doc.restSec).toBe(75)
    expect(ui.toast).toHaveBeenCalledTimes(1)
  })

  it('erledigte Sätze: der Ersatz kommt daneben, eine Pause dahinter rückt mit', async () => {
    const a = running()
    a.entries = [entry('0334', [0]), entry('0027')]
    signedIn(a)
    ui.timer = { left: 60, total: 90, forIdx: 1 }
    hook(order())
    await useStore.getState().pullState()
    await tick()
    expect(S().active.entries.map(e => e.id)).toEqual(['0334', '0584', '0027'])
    expect(ui.timer.forIdx).toBe(2)
  })

  it('ohne laufendes Training: verfällt, kein Hinweis, ein späteres Training bleibt unberührt', async () => {
    signedIn(null)
    hook(order())
    await useStore.getState().pullState()
    await tick()
    expect(S().active).toBe(null)
    expect(localStorage.getItem('gym_coach_live_done')).toBe('L1')
    expect(ui.toast).not.toHaveBeenCalled()
    useStore.getState().update(s => { s.active = running() })
    await tick()
    expect(S().active.entries.map(e => e.id)).toEqual(['0025', '0334'])
  })

  it('die erledigte ID bleibt auf dem Gerät und geht nicht an den Server', async () => {
    signedIn(running())
    hook(order())
    await useStore.getState().pullState()
    useStore.getState().update(s => { s.restSec = 30 })
    await useStore.getState().pushState()
    expect(JSON.stringify(doc)).not.toContain('gym_coach_live_done')
    expect(doc.active).toBeUndefined()
    expect(doc.coachLive.id).toBe('L1')
  })
})
