// Thilos Fork: Satzpause in der iPhone-App an RestActivityPlugin (ios/App/App) weitergeben:
// Ton per Mitteilung, wenn die App nicht offen ist, und Countdown als Live-Aktivität auf dem
// Sperrbildschirm. Im Web und unter Android passiert hier nichts.
import { MOBILE } from './mobile.js'

let plugin = null
let checked = null

async function restActivity() {
  if (!MOBILE) return null
  if (checked === null) {
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core')
      checked = Capacitor.getPlatform() === 'ios'
      if (checked) plugin = registerPlugin('RestActivity')
    } catch { checked = false }
  }
  return checked ? plugin : null
}

const call = (method, args) => { restActivity().then(p => p?.[method](args)).catch(() => {}) }

export const iosRestStart = (endsAt, { totalSec, title, doneTitle, sound }) =>
  call('start', { endsAt, totalSec, title, doneTitle, sound: !!sound })
export const iosRestHold = (leftSec, totalSec, { title, doneTitle } = {}) =>
  call('hold', { leftSec, totalSec, title, doneTitle })
export const iosRestStop = () => call('stop', {})
