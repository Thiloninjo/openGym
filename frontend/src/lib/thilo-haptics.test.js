// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { haptic, installHaptics, kindFromMs, kindOf, setHapticSink, tapTarget } from './thilo-haptics.js'
import { setVibrate, vibrate } from './sound.js'

const html = s => { document.body.innerHTML = s; return document.body }

describe('was als Tap zählt', () => {
  it('Knöpfe, Links, Zeilen mit role=button, Chips und Tage', () => {
    html('<button id=b><span id=in>x</span></button><a id=a href="#">a</a><div id=r role="button">r</div>'
      + '<span class="chip" id=c>c</span><div class="wday" id=w>1</div>')
    for (const id of ['b', 'in', 'a', 'r', 'c', 'w']) expect(tapTarget(document.getElementById(id)), id).not.toBe(null)
    expect(tapTarget(document.getElementById('in')).id).toBe('b')
  })
  it('nicht Text, Textfelder und gesperrte Knöpfe', () => {
    html('<p id=p>t</p><input id=i type="text"><button id=d disabled>x</button><div id=ad role="button" aria-disabled="true">x</div>')
    for (const id of ['p', 'i', 'd', 'ad']) expect(tapTarget(document.getElementById(id)), id).toBe(null)
  })
})

describe('welcher Impuls', () => {
  it('Warnung für danger, Auswahl für Schalter, Segmente und Chips, sonst leicht', () => {
    html('<button class="btn danger" id=del>x</button><button class="sw" id=sw></button>'
      + '<div class="seg"><button id=seg>a</button></div><span class="chip" id=chip>c</span><button class="btn" id=btn>b</button>')
    const k = id => kindOf(document.getElementById(id))
    expect(k('del')).toBe('warning')
    expect(k('sw')).toBe('selection')
    expect(k('seg')).toBe('selection')
    expect(k('chip')).toBe('selection')
    expect(k('btn')).toBe('light')
  })
  it('die alten vibrate()-Längen', () => {
    expect(kindFromMs(4)).toBe('selection')
    expect(kindFromMs(8)).toBe('light')
    expect(kindFromMs(15)).toBe('medium')
    expect(kindFromMs(30)).toBe('medium')
    expect(kindFromMs([200, 100, 200])).toBe('heavy')
  })
})

describe('Tap und gezielter Impuls', () => {
  const fired = []
  beforeEach(() => { fired.length = 0; setHapticSink(k => fired.push(k)); vi.useFakeTimers(); installHaptics(); setVibrate(true) })
  afterEach(() => { vi.useRealTimers(); setHapticSink(null) })

  it('ein Tap gibt nach dem Klick einen leichten Impuls', () => {
    html('<button id=b>x</button>')
    document.getElementById('b').click()
    expect(fired).toEqual([])
    vi.runAllTimers()
    expect(fired).toEqual(['light'])
  })
  it('ein gezielter Impuls im selben Klick ersetzt den Tap', () => {
    html('<button id=b>x</button>')
    const b = document.getElementById('b')
    b.addEventListener('click', () => haptic('success'))
    b.click()
    vi.runAllTimers()
    expect(fired).toEqual(['success'])
  })
  it('vibrate() aus lib/sound.js ersetzt den Tap ebenfalls (Satz abhaken)', () => {
    const nav = vi.fn()
    vi.stubGlobal('navigator', { ...globalThis.navigator, vibrate: nav })
    html('<button id=b>x</button>')
    const b = document.getElementById('b')
    b.addEventListener('click', () => vibrate(30))
    b.click()
    vi.runAllTimers()
    // ohne Taptic Engine geht das alte Muster an navigator.vibrate, und der Tap bleibt still
    expect(nav).toHaveBeenCalledWith(30)
    expect(fired).toEqual([])
    vi.unstubAllGlobals()
  })
  it('Klicks auf Text lösen nichts aus', () => {
    html('<p id=p>t</p>')
    document.getElementById('p').click()
    vi.runAllTimers()
    expect(fired).toEqual([])
  })
})
