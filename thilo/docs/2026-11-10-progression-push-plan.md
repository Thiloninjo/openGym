# Zielkarte, Satzvergleich und Progressions-Kachel – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App zeigt an jeder Übung das Ziel von heute gegen das letzte Mal, vergleicht jeden Satz mit dem letzten Mal und zählt am Ende die gesteigerten Übungen (Spec: `thilo/docs/2026-11-10-progression-push.md`).

**Architecture:** Reine Funktionen in `frontend/src/lib/thilo-target.js` machen aus `entry.plan` (Progression), `lastEntryFor` (letztes Mal) und den Sätzen die Anzeige-Modelle. `ThiloTargetCard.jsx` zeigt die Karte; `views/Workout.jsx` und `sheets.jsx` binden alles nur bei `thiloRules()` ein.

**Tech Stack:** React 19, Vite, Vitest (happy-dom für Komponenten), kein TypeScript, kein Linter.

Alle Befehle aus `H:/Projects/openGym/frontend`.

---

### Task 1: Reine Funktionen `lib/thilo-target.js`

**Files:**
- Create: `frontend/src/lib/thilo-target.js`
- Test: `frontend/src/lib/thilo-target.test.js`

- [ ] **Step 1: Failing test schreiben**

```js
// Thilos Fork: Zielkarte, Satzvergleich und Progressions-Kachel (lib/thilo-target.js).
import { describe, expect, it } from 'vitest'
import { targetCard, setDelta, prevSetAt, progressCount, lastText } from './thilo-target.js'

const last = (sets, reps = 12) => ({ d: '2026-11-05', sets: sets.map(([w, r]) => ({ w, r, done: true })), target: { sets: sets.length, reps } })
const base = { mode: 'reps', unit: 'kg', id: 'x', planned: { sets: 3, reps: 12, repsMin: 8 } }

describe('targetCard', () => {
  it('alle Sätze oben: eine Stufe höher mit ≈ Gewicht und Bereich, darunter das letzte Mal', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'up', weight: 57, reps: 8, why: ['…'] }, last: last([[52, 12], [52, 12], [52, 12]]) })
    expect(c).toEqual({ tone: 'up', head: ['Today: 1 step up'], sub: ['≈ {0} {1} · {2}–{3} reps', '57', 'kg', 8, 12], extra: null, last: '52 kg · 12 · 12 · 12' })
  })
  it('up ohne höheres Gewicht (Satz mehr, weniger Hilfe): Text der Engine', () => {
    const why = ['{0} reps in every set! Add a set at {1} reps.', 12, 8]
    const c = targetCard({ ...base, plan: { policy: 'triple', kind: 'up', weight: 52, why }, last: last([[52, 12], [52, 12]]) })
    expect(c.tone).toBe('up')
    expect(c.head).toEqual(why)
  })
  it('gleiches Gewicht: Wiederholungsziel pro Satz, mit Gewicht', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 10, reps: 13, why: ['…'] }, last: last([[10, 14], [10, 12], [10, 12]], 12) })
    expect(c).toEqual({ tone: 'hold', head: ['Today: {0} reps per set', 13], sub: ['with {0} {1}', '10', 'kg'], extra: null, last: '10 kg · 14 · 12 · 12' })
  })
  it('ein Satz letztes Mal unter dem Ziel: fehlende Wdh. mit Satznummer', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 52, reps: 12, why: ['…'] }, last: last([[52, 12], [52, 12], [52, 11]], 12) })
    expect(c.extra).toEqual(['Last time set {0} was {1} rep short. Get it today.', 3, 1])
  })
  it('mehrere Sätze unter dem Ziel: Anzahl der Sätze', () => {
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'hold', weight: 52, reps: 13, why: ['…'] }, last: last([[52, 13], [52, 12], [52, 11]], 13) })
    expect(c.extra).toEqual(['Last time {0} sets fell short. Get them today.', 2])
  })
  it('gehalten ohne Wiederholungsziel nach verfehlten Wdh.: die fehlenden holen', () => {
    const c = targetCard({ ...base, plan: { policy: 'linear', kind: 'hold', weight: 52, why: ['Missed reps last time. Same weight again ({0} of {1} to go).', 2, 3] }, last: last([[52, 12], [52, 10]], 12) })
    expect(c.head).toEqual(['Today: get the missing reps'])
    expect(c.sub).toEqual(['with {0} {1}', '52', 'kg'])
  })
  it('Deload: leichter mit Gewicht, Begründung der Engine darunter', () => {
    const why = ['Stuck for {0} sessions. Deload to {1} {2}.', 3, 47, 'kg']
    const c = targetCard({ ...base, plan: { policy: 'double', kind: 'deload', weight: 47, reps: 8, why }, last: last([[52, 9], [52, 8]]) })
    expect(c).toMatchObject({ tone: 'down', head: ['Today lighter: {0} {1}', '47', 'kg'], sub: why })
  })
  it('Halteübung: Sekunden halten', () => {
    const c = targetCard({ ...base, mode: 'time', plan: { policy: 'time', kind: 'up', sec: 65, why: ['…'] }, last: { d: '2026-11-05', sets: [{ sec: 60, done: true }], target: { sec: 60 } } })
    expect(c.tone).toBe('up')
    expect(c.head).toEqual(['Today: hold {0} s', 65])
  })
  it('keine Karte: erstes Mal, aus, Cardio, ohne Plan', () => {
    const l = last([[52, 12]])
    expect(targetCard({ ...base, plan: { policy: 'double', kind: 'first', why: ['…'] }, last: null })).toBeNull()
    expect(targetCard({ ...base, plan: { policy: 'off', kind: 'off' }, last: l })).toBeNull()
    expect(targetCard({ ...base, mode: 'cardio', plan: { policy: 'double', kind: 'hold', weight: 0, why: ['…'] }, last: l })).toBeNull()
    expect(targetCard({ ...base, plan: undefined, last: l })).toBeNull()
  })
})

describe('lastText', () => {
  it('ein Gewicht: Gewicht einmal, dann die Wiederholungen', () => {
    expect(lastText(last([[52, 12], [52, 11]]), 'x', 'kg')).toBe('52 kg · 12 · 11')
  })
  it('gemischte Gewichte: jeder Satz für sich', () => {
    expect(lastText(last([[52, 12], [57, 8]]), 'x', 'kg')).toBe('52×12 · 57×8')
  })
  it('ohne letztes Mal null', () => {
    expect(lastText(null, 'x', 'kg')).toBeNull()
  })
})

describe('setDelta', () => {
  const opt = { mode: 'reps', unit: 'kg' }
  it('mehr Gewicht zählt als besser, auch mit weniger Wdh.', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 57, r: 9 }, opt)).toEqual({ sign: 1, text: '+5 kg' })
  })
  it('gleiches Gewicht: Wiederholungen', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 13 }, opt)).toEqual({ sign: 1, text: '+1' })
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 12 }, opt)).toEqual({ sign: 0, text: '=' })
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 10 }, opt)).toEqual({ sign: -1, text: '−2' })
  })
  it('weniger Gewicht', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 47, r: 12 }, opt)).toEqual({ sign: -1, text: '−5 kg' })
  })
  it('Hilfe an der Maschine: weniger Gewicht ist besser', () => {
    expect(setDelta({ w: 30, r: 8 }, { w: 25, r: 8 }, { ...opt, assisted: true })).toEqual({ sign: 1, text: '−5 kg' })
  })
  it('Halteübung: Sekunden', () => {
    expect(setDelta({ sec: 60 }, { sec: 65 }, { mode: 'time', unit: 'kg' })).toEqual({ sign: 1, text: '+5 s' })
  })
  it('kein Vergleich ohne Wdh., ohne letzten Satz, bei Cardio', () => {
    expect(setDelta({ w: 52, r: 12 }, { w: 52, r: 0 }, opt)).toBeNull()
    expect(setDelta(null, { w: 52, r: 12 }, opt)).toBeNull()
    expect(setDelta({ min: 10 }, { min: 12 }, { mode: 'cardio', unit: 'kg' })).toBeNull()
  })
})

describe('prevSetAt', () => {
  const l = last([[52, 12], [52, 11]])
  it('Arbeitssatz i gegen Arbeitssatz i, Aufwärmsätze zählen nicht', () => {
    const sets = [{ w: 30, r: 10, warmup: true }, { w: 52, r: 12 }, { w: 52, r: 12 }, { w: 52, r: 12 }]
    expect(prevSetAt(l, sets, 0)).toBeNull()
    expect(prevSetAt(l, sets, 1)).toBe(l.sets[0])
    expect(prevSetAt(l, sets, 2)).toBe(l.sets[1])
    expect(prevSetAt(l, sets, 3)).toBeNull()
  })
  it('ohne letztes Mal null', () => {
    expect(prevSetAt(null, [{ w: 52, r: 12 }], 0)).toBeNull()
  })
})

describe('progressCount', () => {
  it('zählt Übungen mit letztem Mal, gesteigert mit Plus', () => {
    const rows = [
      { id: 'a', today: [{ w: 57, r: 9 }], last: [{ w: 52, r: 12 }], trend: 1 },
      { id: 'b', today: [{ w: 10, r: 13 }, { w: 10, r: 13 }], last: [{ w: 10, r: 12 }, { w: 10, r: 11 }], trend: 1 },
      { id: 'c', today: [{ w: 40, r: 10 }], last: [{ w: 40, r: 10 }], trend: 0 },
      { id: 'd', today: [{ w: 20, r: 10 }], last: null, trend: null },
    ]
    expect(progressCount(rows, 'kg')).toEqual({ up: [{ id: 'a', plus: '+5 kg' }, { id: 'b', plus: '+3 reps' }], of: 3 })
  })
})
```

`warmup: true` markiert einen Aufwärmsatz (`phaseForSet` in `lib/workout-model.js`).

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run src/lib/thilo-target.test.js`
Expected: FAIL, Modul `./thilo-target.js` fehlt.

- [ ] **Step 3: Implementierung**

```js
// Thilos Fork: Zielkarte, Satzvergleich und Progressions-Kachel (thilo/docs/2026-11-10-progression-push.md).
// Reine Funktionen: aus dem Ergebnis der Progression (entry.plan), dem letzten Mal (lastEntryFor, nur
// Arbeitssätze) und den heutigen Sätzen wird, was Karte, Satzzeile und Abschluss anzeigen.
import { normalizeRepRange } from './rep-range.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { setLabel } from './history.js'
import { fmtNum } from './format.js'
import { t } from './i18n-core.js'

const EPS = 1e-9
const round2 = v => Math.round(v * 100) / 100
const topWeight = sets => (sets || []).reduce((m, s) => Math.max(m, Number(s.w) || 0), 0)
const repsSum = sets => (sets || []).reduce((n, s) => n + (Number(s.r) || 0), 0)

/** „52 kg · 12 · 11“ bei einem Gewicht, sonst die Sätze einzeln („52×12 · 57×8“); ohne letztes Mal null. */
export function lastText(last, id, unit, speedUnit) {
  const sets = last?.sets || []
  if (!sets.length) return null
  const w = Number(sets[0].w) || 0
  const oneWeight = w > 0 && sets.every(s => Number(s.r) > 0 && !(s.sec > 0) && !(s.min > 0) && Math.abs((Number(s.w) || 0) - w) < EPS)
  if (oneWeight) return `${fmtNum(w)} ${unit} · ` + sets.map(s => s.r).join(' · ')
  return sets.map(s => setLabel(id, s, last.target, speedUnit)).join(' · ')
}

/** Arbeitssätze des letzten Mals unter dessen Ziel: [{ n: Satznummer, short: fehlende Wdh. }]. */
function shortSets(last) {
  const goal = Number(last?.target?.reps) || 0
  if (!goal) return []
  return (last.sets || [])
    .map((s, i) => ({ n: i + 1, r: Number(s.r) || 0 }))
    .filter(x => x.r > 0 && x.r < goal)
    .map(x => ({ n: x.n, short: goal - x.r }))
}

/**
 * Die Zielkarte einer Übung oder null.
 * plan: entry.plan · last: lastEntryFor(…) · planned: entry.planned (Wiederholungsbereich der Routine)
 * mode: reps | time | cardio · unit: S.unit · id: Übungs-ID · speedUnit: für setLabel
 */
export function targetCard({ plan, last, planned, mode, unit, id, speedUnit }) {
  if (!plan || mode === 'cardio' || plan.policy === 'off' || plan.kind === 'off' || plan.kind === 'first') return null
  const lastLine = last ? lastText(last, id, unit, speedUnit) : null
  const card = (tone, head, sub = null, extra = null) => ({ tone, head, sub, extra, last: lastLine })
  if (mode === 'time') {
    if (plan.kind === 'deload') return plan.why ? card('down', plan.why) : null
    return plan.sec > 0 ? card(plan.kind === 'up' ? 'up' : 'hold', ['Today: hold {0} s', plan.sec]) : null
  }
  const w = Number(plan.weight) || 0
  if (plan.kind === 'deload') return card('down', ['Today lighter: {0} {1}', fmtNum(w), unit], plan.why || null)
  if (plan.kind === 'up') {
    const before = last ? topWeight(last.sets) : 0
    if (before > 0 && w > before + EPS) {
      const range = planned?.reps > 0 ? normalizeRepRange(planned.reps, planned.repsMin) : null
      return card('up', ['Today: 1 step up'], range
        ? ['≈ {0} {1} · {2}–{3} reps', fmtNum(w), unit, range.repsMin, range.reps]
        : ['≈ {0} {1}', fmtNum(w), unit])
    }
    return plan.why ? card('up', plan.why) : null
  }
  const short = shortSets(last)
  const extra = short.length === 1 ? ['Last time set {0} was {1} rep short. Get it today.', short[0].n, short[0].short]
    : short.length > 1 ? ['Last time {0} sets fell short. Get them today.', short.length] : null
  const withW = w > 0 ? ['with {0} {1}', fmtNum(w), unit] : null
  if (plan.reps > 0) return card('hold', ['Today: {0} reps per set', plan.reps], withW, extra)
  if (short.length) return card('hold', ['Today: get the missing reps'], withW)
  return plan.why ? card('hold', plan.why, withW) : null
}

/** Der Arbeitssatz des letzten Mals zu Zeile i von heute (Aufwärmsätze zählen nicht), oder null. */
export function prevSetAt(last, sets, i) {
  const s = sets?.[i]
  if (!s || isWarmupRow(s) || isSideSet(s)) return null
  const k = sets.slice(0, i + 1).filter(x => !isWarmupRow(x)).length - 1
  return last?.sets?.[k] ?? null
}

/** Satz heute gegen denselben Arbeitssatz letztes Mal: { sign: 1 | 0 | -1, text } oder null. */
export function setDelta(prev, cur, { mode, unit, assisted = false }) {
  if (!prev || !cur) return null
  if (mode === 'time') {
    if (!(cur.sec > 0) || !(prev.sec > 0)) return null
    const ds = Math.round(cur.sec - prev.sec)
    return ds > 0 ? { sign: 1, text: `+${ds} s` } : ds < 0 ? { sign: -1, text: `−${-ds} s` } : { sign: 0, text: '=' }
  }
  if (mode !== 'reps' || !(Number(cur.r) > 0) || !(Number(prev.r) > 0)) return null
  const dw = round2((Number(cur.w) || 0) - (Number(prev.w) || 0))
  if (Math.abs(dw) > EPS) {
    // An einer Maschine mit Hilfe ist weniger Gewicht weniger Hilfe, also besser.
    const sign = (dw > 0) !== assisted ? 1 : -1
    return { sign, text: `${dw > 0 ? '+' : '−'}${fmtNum(Math.abs(dw))} ${unit}` }
  }
  const dr = Math.round(cur.r) - Math.round(prev.r)
  return dr > 0 ? { sign: 1, text: `+${dr}` } : dr < 0 ? { sign: -1, text: `−${-dr}` } : { sign: 0, text: '=' }
}

/** Für den Abschluss: gesteigerte Übungen (trend > 0 aus finishCompare) mit ihrem Plus, von allen mit letztem Mal. */
export function progressCount(rows, unit) {
  const withLast = (rows || []).filter(r => r.last?.length)
  const up = withLast.filter(r => r.trend > 0).map(r => {
    const dw = round2(topWeight(r.today) - topWeight(r.last))
    return { id: r.id, plus: dw > EPS ? `+${fmtNum(dw)} ${unit}` : t('+{0} reps', repsSum(r.today) - repsSum(r.last)) }
  })
  return { up, of: withLast.length }
}
```

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `npx vitest run src/lib/thilo-target.test.js`
Expected: PASS (alle Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/thilo-target.js frontend/src/lib/thilo-target.test.js
git commit -m "feat(thilo): Ziel, Satzvergleich und Progressionszähler als reine Funktionen"
```

### Task 2: Zielkarte, Stil und Texte

**Files:**
- Create: `frontend/src/components/ThiloTargetCard.jsx`
- Test: `frontend/src/components/ThiloTargetCard.test.jsx`
- Modify: `frontend/src/thilo-theme.css` (am Ende anhängen)
- Modify: `frontend/src/locales/de.js` (nach dem Block „Thilos Fork: Startseite im Powerfit-Look“, hinter `'Lime': 'Lime',`)

- [ ] **Step 1: Failing test**

```jsx
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
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run src/components/ThiloTargetCard.test.jsx`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Komponente**

```jsx
// Thilos Fork: Zielkarte oben an jeder Übung (thilo/docs/2026-11-10-progression-push.md). Das Modell
// kommt aus lib/thilo-target.js targetCard; ein Tipp öffnet wie die alte Hinweiszeile die Übungseinstellungen.
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

const ICON = { up: 'arrowUp', down: 'arrowDown', hold: 'chartLine' }

export default function ThiloTargetCard({ model, onOpen }) {
  if (!model) return null
  return <button type="button" className={'thilo-target ' + model.tone} data-testid="thilo-target"
    onClick={onOpen} disabled={!onOpen} aria-label={t(...model.head)}>
    <Icon name={ICON[model.tone] || 'chartLine'} />
    <span className="thilo-target-body">
      <span className="thilo-target-head">{t(...model.head)}</span>
      {model.sub && <span className="thilo-target-sub">{t(...model.sub)}</span>}
      {model.extra && <span className="thilo-target-sub">{t(...model.extra)}</span>}
      {model.last && <span className="thilo-target-last">{t('Last time: {0}', model.last)}</span>}
    </span>
  </button>
}
```

- [ ] **Step 4: Stil an `thilo-theme.css` anhängen**

```css
/* ------------------------------------------------- Zielkarte und Satzvergleich -- */
/* thilo/docs/2026-11-10-progression-push.md */
.thilo-target{display:flex;gap:10px;align-items:flex-start;width:100%;margin:0 0 10px;padding:10px 12px;
  border:0;border-radius:14px;background:var(--surface-2);color:var(--label);text-align:start;font:inherit}
.thilo-target:disabled{opacity:1}
.thilo-target svg{flex:none;margin-top:2px;font-size:18px;color:var(--label-2)}
.thilo-target.up{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--acc) 55%,transparent)}
.thilo-target.up svg,.thilo-target.up .thilo-target-head{color:var(--acc)}
.thilo-target.down svg,.thilo-target.down .thilo-target-head{color:var(--yellow)}
.thilo-target-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.thilo-target-head{font-family:var(--display);font-weight:700;font-size:19px;line-height:1.1;letter-spacing:.02em;text-transform:uppercase}
.thilo-target-sub{font-size:14px;line-height:1.3}
.thilo-target-last{font-size:13px;color:var(--label-2);font-variant-numeric:tabular-nums}
.thilo-cmp{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin:-2px 6px 4px;font-size:12px;
  color:var(--label-2);font-variant-numeric:tabular-nums}
.thilo-cmp .d{padding:1px 8px;border-radius:999px;background:var(--surface-3);font-weight:700}
.thilo-cmp .d.up{background:var(--acc);color:var(--on-acc)}
```

- [ ] **Step 5: Deutsche Texte in `locales/de.js`**

Vorher prüfen, dass keiner der Schlüssel schon existiert (`grep -n "'Last time: {0}'" src/locales/de.js` usw.). Einfügen hinter `'Lime': 'Lime',`:

```js
  // Thilos Fork: Zielkarte, Satzvergleich, Progressions-Kachel (lib/thilo-target.js)
  'Today: 1 step up': 'Heute: 1 Stufe höher',
  '≈ {0} {1} · {2}–{3} reps': '≈ {0} {1} · {2}–{3} Wdh.',
  '≈ {0} {1}': '≈ {0} {1}',
  'Today: {0} reps per set': 'Heute: {0} Wdh. pro Satz',
  'with {0} {1}': 'mit {0} {1}',
  'Today: get the missing reps': 'Heute: die fehlenden Wdh. holen',
  'Today lighter: {0} {1}': 'Heute leichter: {0} {1}',
  'Today: hold {0} s': 'Heute: {0} s halten',
  'Last time set {0} was {1} rep short. Get it today.': 'Letztes Mal fehlte {1} Wdh. in Satz {0}, heute holen.',
  'Last time {0} sets fell short. Get them today.': 'Letztes Mal fehlten in {0} Sätzen Wdh., heute holen.',
  'Last time: {0}': 'Letztes Mal: {0}',
  'last time {0}': 'letztes Mal {0}',
  '{0} of {1} exercises up': '{0} von {1} Übungen gesteigert',
  '+{0} reps': '+{0} Wdh.',
```

- [ ] **Step 6: Tests grün**

Run: `npx vitest run src/components/ThiloTargetCard.test.jsx src/lib/thilo-target.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ThiloTargetCard.jsx frontend/src/components/ThiloTargetCard.test.jsx frontend/src/thilo-theme.css frontend/src/locales/de.js
git commit -m "feat(thilo): Zielkarte mit Stil und deutschen Texten"
```

### Task 3: Einbau ins Training (`views/Workout.jsx`)

**Files:**
- Modify: `frontend/src/views/Workout.jsx`

- [ ] **Step 1: Imports**

Zeile 9 ändern zu `import { exOr, betterWeight, isAssisted } from '../lib/exercises.js'` und hinter dem Import von `ThiloMiniHistory` (Zeile 34) ergänzen:

```js
import ThiloTargetCard from '../components/ThiloTargetCard.jsx'
import { targetCard, prevSetAt, setDelta } from '../lib/thilo-target.js'
import { thiloRules } from '../lib/thilo-rules.js'
import { haptic } from '../lib/thilo-haptics.js'
```

- [ ] **Step 2: Modell in `ExerciseBlock`** direkt hinter `const guidance = progressionGuidance(plan)`:

```js
  // Thilos Fork: Zielkarte statt der Hinweiszeile und Satzvergleich je Zeile (lib/thilo-target.js).
  const thilo = thiloRules()
  const target = thilo ? targetCard({ plan, last, planned: entry.planned, mode, unit: S.unit, id: entry.id, speedUnit: speedUnitOf(S) }) : null
  const assisted = isAssisted(entry.id)
```

- [ ] **Step 3: Karte unter der Kopfzeile** – direkt vor `{entry.noProg === true && <div className="noprog">`:

```jsx
    {target && <ThiloTargetCard model={target} onOpen={onProgressionSettings} />}
```

- [ ] **Step 4: Alte Hinweiszeile im Fork ausblenden** – `{guidance && onProgressionSettings && <button type="button" className={'progline' …` wird zu `{!thilo && guidance && onProgressionSettings && <button …`.

- [ ] **Step 5: Satzvergleich** – in der Satzliste direkt hinter `{!pairTail && swipeRow(s, i, …)}` (vor dem `swhint`-Block):

```jsx
          {thilo && !warm && (() => {
            const prev = prevSetAt(last, entry.sets, i)
            if (!prev) return null
            const d = s.done ? setDelta(prev, s, { mode, unit: S.unit, assisted }) : null
            return <div className="thilo-cmp" data-testid="thilo-cmp">
              <span>{t('last time {0}', setLabel(entry.id, prev, last.target, speedUnitOf(S)))}</span>
              {d && <span className={'d' + (d.sign > 0 ? ' up' : '')}>{d.text}</span>}
            </div>
          })()}
```

- [ ] **Step 6: Erfolgs-Impuls im `toggle`** (WorkoutView, `const toggle = (idx, i, side, …)`): hinter `const m = modeAt(idx)` und `const cardioEntry = …` einfügen:

```js
    // Thilos Fork: ein Satz, der das letzte Mal schlägt, bekommt beim Abhaken den Erfolgs-Impuls.
    const en0 = A.entries[idx]
    const prev0 = thiloRules() && !side && !en0.sets[i].done ? prevSetAt(lastEntryFor(sessionHistory(S), en0.id, en0.rid), en0.sets, i) : null
    const better = !!prev0 && setDelta(prev0, en0.sets[i], { mode: m, unit: S.unit, assisted: isAssisted(en0.id) })?.sign > 0
```

und `if (!quiet) { beep(S.sound, 1040, 0.12); vibrate(30) }` ersetzen durch:

```js
        if (!quiet) { beep(S.sound, 1040, 0.12); if (better) haptic('success'); else vibrate(30) }
```

- [ ] **Step 7: Bestehende Workout-Tests laufen lassen**

Run: `npx vitest run src/views`
Expected: PASS (ohne Schalter ändert sich nichts).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/Workout.jsx
git commit -m "feat(thilo): Zielkarte und Satzvergleich im Training, Erfolgs-Impuls bei besserem Satz"
```

### Task 4: Kachel im Abschluss (`sheets.jsx`)

**Files:**
- Modify: `frontend/src/sheets.jsx` (`FinishSummary`, Imports)

- [ ] **Step 1: Imports** (bei den übrigen `./lib/`-Imports):

```js
import { progressCount } from './lib/thilo-target.js'
import { thiloRules } from './lib/thilo-rules.js'
```

(Falls `thiloRules` in `sheets.jsx` schon importiert ist, nicht doppelt.)

- [ ] **Step 2: In `FinishSummary`** hinter `const st = useStore(s => s.S)`:

```js
  // Thilos Fork: wie viele Übungen gegenüber dem letzten Mal gesteigert wurden (lib/thilo-target.js).
  const prog = thiloRules() ? progressCount(finishCompare(st, w), st.unit) : null
```

und in den `tiles` hinter der Schritte-Kachel:

```jsx
      {prog && prog.of > 0 && <div className="tile" style={{ gridColumn: '1 / -1' }} data-testid="thilo-progress">
        <div className="l">{t('Progression')}</div>
        <div className="v" style={{ fontSize: '1.1rem' }}>{t('{0} of {1} exercises up', prog.up.length, prog.of)}</div>
        {prog.up.length > 0 && <div className="small accent">{prog.up.map(u => `${EXIDX[u.id] ? exerciseNameFor(EXIDX[u.id]) : u.id} ${u.plus}`).join(' · ')}</div>}
      </div>}
```

- [ ] **Step 3: Tests**

Run: `npx vitest run src/sheets*.test.jsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/sheets.jsx
git commit -m "feat(thilo): Kachel „Progression“ im Trainingsabschluss"
```

### Task 5: Gesamtprüfung, Build, Doku

- [ ] **Step 1: Alle Frontend-Tests**

Run: `npm test`
Expected: alles grün außer dem schon vorher fehlschlagenden `check-mobile-bundle.test.mjs` (SyntaxError, Datei unverändert; siehe Gym-Roadmap 09.11.2026).

- [ ] **Step 2: Produktions-Build**

Run: `npm run build`
Expected: Build ohne Fehler.

- [ ] **Step 3: Doku** – in `thilo/docs/2026-11-06-progression.md` unter „Mini-Verlauf“ einen Abschnitt „Zielkarte und Satzvergleich (10.11.2026)“ mit Verweis auf die Spec ergänzen.

- [ ] **Step 4: Commit**

```bash
git add thilo/docs/2026-11-06-progression.md
git commit -m "docs(thilo): Verweis auf Zielkarte und Satzvergleich"
```

- [ ] **Step 5: Auslieferung** – Thilo fragen, ob `training-live` gepusht werden soll (startet den Codemagic-Build 9). Erst nach Ja pushen.
