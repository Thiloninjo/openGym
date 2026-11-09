// Thilos Fork: Haptik bei jedem Tap und stärker bei wichtigen Aktionen
// (thilo/docs/2026-11-09-powerfit-design.md).
//
// iPhone-App: ThiloHapticsPlugin (ios/App/App, Taptic Engine), weil die Web-Ansicht dort kein
// navigator.vibrate kennt. Android und Browser: navigator.vibrate. Sonst passiert nichts.
//
//   haptic(kind)       gezielter Impuls: light | medium | heavy | selection | success | warning
//   installHaptics()   einmal beim Start (main.jsx): Tap-Impulse für die ganze App und die
//                      bestehenden vibrate()-Aufrufe aus lib/sound.js auf die Haptik umleiten
//
// Ein Tap meldet sich beim Loslassen (click), nicht bei der Berührung: so vibriert Scrollen nicht.
// Sein Impuls wartet, bis die Klick-Handler gelaufen sind. Löst einer davon selbst einen Impuls
// aus (Satz abhaken, Training beenden), gilt nur dieser, und der Tap bleibt still.
import { MOBILE } from './mobile.js'
import { setBuzzHook } from './sound.js'

export const KINDS = ['light', 'medium', 'heavy', 'selection', 'success', 'warning']
// Ersatz ohne Taptic Engine, in Millisekunden für navigator.vibrate.
const VIBRATE = { light: 8, selection: 5, medium: 14, heavy: 22, success: [12, 60, 18], warning: [20, 80, 20] }

// Was als antippbar gilt. Textfelder fehlen absichtlich: ins Feld tippen ist kein Knopfdruck.
const TAP = [
  'button', 'a[href]', 'summary', 'select', 'label',
  'input[type="checkbox"]', 'input[type="radio"]',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="option"]', '[role="menuitem"]',
  '.chip', '.wday', '.cal-d', '.swatch',
].join(',')
// Auswählen statt Auslösen: Schalter, Segmente, Chips, Tage. iOS gibt dafür den feinen Klick.
const SELECT = [
  '.sw', '[role="switch"]', '[role="tab"]', '[role="option"]', '.seg button', '.chip', '.wday',
  '.cal-d', '.swatch', 'select', 'input[type="checkbox"]', 'input[type="radio"]',
].join(',')

let plugin = null
let loading = null
let native = false
let installed = false
// Der Impuls des laufenden Taps, bis die Handler durch sind; 0 = keiner wartet.
let pendingTap = 0
let seq = 0

// Nur ein Wahrheitswert kommt aus dem Promise, nie das Plugin selbst (wie lib/thilo-ios-training.js:
// der Proxy von registerPlugin beantwortet `then` mit einem nativen Aufruf, der nie zurückkommt).
const ready = () => loading || (loading = (async () => {
  if (!MOBILE) return false
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return false
  plugin = registerPlugin('ThiloHaptics')
  return true
})().catch(() => false))

function play(kind) {
  if (native && plugin) {
    try { plugin.play({ kind }).catch(() => {}) } catch { /* */ }
    return
  }
  buzz(VIBRATE[kind] ?? VIBRATE.light)
}
function buzz(p) {
  try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(p) } catch { /* */ }
}

// Austauschbar für die Tests, die nur wissen wollen, welcher Impuls kommt.
let sink = play
export function setHapticSink(fn) { sink = typeof fn === 'function' ? fn : play }

/** Ein gezielter Impuls. Ersetzt den Tap-Impuls desselben Klicks. */
export function haptic(kind = 'light') {
  pendingTap = 0
  sink(KINDS.includes(kind) ? kind : 'light')
}

/** Das antippbare Element zu einem Klickziel, oder null (Text, Felder, gesperrte Knöpfe). */
export function tapTarget(target) {
  const el = target?.closest?.(TAP)
  if (!el) return null
  if (el.matches(':disabled, [aria-disabled="true"]') || el.closest('fieldset:disabled')) return null
  return el
}

/** Welcher Impuls zu einem antippbaren Element gehört. */
export function kindOf(el) {
  if (el.closest('.danger')) return 'warning'
  if (el.matches(SELECT)) return 'selection'
  return 'light'
}

/** Die alten vibrate(ms)-Stellen als Impuls: Wheel 4, Wischen 8/15, Satz und Halten 30, Muster. */
export function kindFromMs(p) {
  if (Array.isArray(p)) return 'heavy'
  const ms = Number(p) || 0
  if (ms <= 5) return 'selection'
  if (ms <= 10) return 'light'
  return 'medium'
}

/** Ein Klick auf der Seite (Capture, vor den Handlern der App). */
export function onTap(e) {
  const el = tapTarget(e.target)
  if (!el) return
  const kind = kindOf(el)
  const id = ++seq
  pendingTap = id
  setTimeout(() => {
    if (pendingTap !== id) return
    pendingTap = 0
    sink(kind)
  }, 0)
}

export function installHaptics() {
  if (installed || typeof document === 'undefined') return
  installed = true
  ready().then(ok => { native = ok })
  document.addEventListener('click', onTap, true)
  // lib/sound.js: auf dem iPhone geht der Impuls an die Taptic Engine, sonst wie bisher an
  // navigator.vibrate mit dem Muster der Stelle. Beides ersetzt den Tap-Impuls.
  setBuzzHook(p => {
    pendingTap = 0
    if (native && plugin) sink(kindFromMs(p))
    else buzz(p)
  })
}
