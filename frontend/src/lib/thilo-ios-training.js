// Thilos Fork: das laufende Training in der iPhone-App an TrainingLivePlugin (ios/App/App) geben.
// Native Seite: Live-Aktivität (Training, Übung, Satz x von y, Trainingszeit; in der Pause Countdown),
// stille Audio-Schleife, damit die App bei gesperrtem Bildschirm wach bleibt, und die Ansage zum
// Pausenende per Stimme (Musik wird dabei leiser). Im Web und unter Android passiert hier nichts.
//
// Aufrufe ans Plugin:
//   start/update({ name, startedAt, exercise, setNo, setCount })   Training beginnt / Bild ändert sich
//   end()                                                         Training vorbei (oder keins mehr da)
//   rest({ endsAt, totalSec, title, doneTitle, speech, sound, lang })   Pause läuft
//   hold({ leftSec, totalSec, title, doneTitle })                 Pause angehalten
//   restStop()                                                    Pause übersprungen oder ersetzt
import { MOBILE } from './mobile.js'

let plugin = null
let loading = null
let failed = false
let reported = false

const isIos = () => MOBILE && globalThis.Capacitor?.getPlatform?.() === 'ios'

// Nur ein Wahrheitswert kommt aus dem Promise, nie das Plugin selbst: der Proxy von registerPlugin
// beantwortet `then` mit einem nativen Aufruf, der nie zurückkommt, und hielte jede Kette an.
const ready = () => loading || (loading = (async () => {
  if (!MOBILE) return false
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return false
  plugin = registerPlugin('TrainingLive')
  return true
})().catch(err => { report('load', err); return false }))

function report(method, err) {
  failed = true
  if (reported) return
  reported = true
  console.error(`[Thilos Fork] TrainingLive.${method} fehlgeschlagen:`, err?.message || err)
}

const call = (method, args = {}) => {
  if (!MOBILE) return
  ready()
    .then(ok => (ok ? plugin[method](args) : undefined))
    .then(() => {}, err => report(method, err))
}

// Spricht die iPhone-App das Pausenende selbst? Dann bleibt der Ton der Seite stumm, damit nichts
// doppelt klingt. Ist das Plugin gescheitert, kommt der Ton der Seite wieder.
export const iosSpeaksRestEnd = () => isIos() && !failed

// Das Bild der Live-Aktivität aus dem laufenden Training: kein Training, ein nachgetragenes oder ein
// bearbeitetes gespeichertes Training ergibt null.
export function trainingSnapshot(active, nameOf) {
  if (!active || active.backfill || active.editingWorkoutId) return null
  const entries = Array.isArray(active.entries) ? active.entries : []
  const cur = Math.min(Math.max(Number.isInteger(active.cur) ? active.cur : 0, 0), Math.max(0, entries.length - 1))
  const e = entries[cur]
  const sets = Array.isArray(e?.sets) ? e.sets : []
  const done = sets.filter(s => s?.done).length
  return {
    name: String(active.name || ''),
    // Ohne Startzeit null, nicht Date.now(): das Bild dient auch als Vergleichsschlüssel.
    startedAt: Number(active.start) || null,
    exercise: e ? String(nameOf(e.id) || '') : '',
    setNo: Math.min(done + 1, sets.length),
    setCount: sets.length,
  }
}

// Folgt dem Training im Store: Start, jede Änderung am Bild, Ende. Beim App-Start ohne Training
// wird eine liegengebliebene Aktivität (App beendet mitten im Training) weggeräumt.
export function watchTraining(store, { nameOf }) {
  if (!MOBILE) return () => {}
  let last = trainingSnapshot(store.getState().S?.active, nameOf)
  let key = last && JSON.stringify(last)
  if (last) call('start', last); else call('end')
  return store.subscribe(state => {
    const snap = trainingSnapshot(state.S?.active, nameOf)
    const k = snap && JSON.stringify(snap)
    if (k === key) return
    if (!snap) call('end')
    // Neue Startzeit heißt neues Training: start, damit die Live-Aktivität neu beginnt.
    else call(last && last.startedAt === snap.startedAt ? 'update' : 'start', snap)
    last = snap
    key = k
  })
}

export const iosRestStart = (endsAt, { totalSec, title, doneTitle, sound, lang } = {}) =>
  call('rest', { endsAt, totalSec, title, doneTitle, speech: doneTitle, sound: !!sound, lang })
export const iosRestHold = (leftSec, totalSec, { title, doneTitle } = {}) =>
  call('hold', { leftSec, totalSec, title, doneTitle })
export const iosRestStop = () => call('restStop')
