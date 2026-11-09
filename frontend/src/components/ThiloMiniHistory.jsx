// Thilos Fork: der Verlauf einer Übung direkt im Training, unter „Letztes Mal“. Eine kleine Kurve
// des schwersten Satzes und die letzten Sessions mit Datum und allen Sätzen; der Knopf öffnet den
// ganzen Übungsverlauf (sheets.jsx ExerciseHistory). Ohne eine geloggte Session nichts.
import { useMemo } from 'react'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { exerciseHistory } from '../lib/exercise-history.js'
import { setLabel } from '../lib/history.js'
import { fmtDate } from '../lib/format.js'
import { speedUnitOf } from '../lib/speed.js'
import { t } from '../lib/i18n.js'

export const MINI_SESSIONS = 4
const MINI_POINTS = 10

export default function ThiloMiniHistory({ S, exId, onOpen }) {
  const h = useMemo(() => exerciseHistory(S, exId, { limit: MINI_SESSIONS }), [S.workouts, exId])
  if (!h.total) return null
  const unit = h.metric === 'weight' ? S.unit : h.metric === 'reps' ? t('reps') : h.metric === 'sec' ? 's' : t('min')
  const points = h.points.slice(-MINI_POINTS)
  return <div className="thilo-hist" data-testid="thilo-mini-history">
    {points.length >= 2 && <div className="thilo-hist-chart"><LineChart points={points} h={56} axes={false} unit={unit} color="var(--blue)" /></div>}
    {h.sessions.map(s => <div key={s.id ?? s.d} className="thilo-hist-row small dim">
      <time dateTime={s.d}>{fmtDate(s.d, true)}</time>
      <span>{s.sets.map(x => setLabel(exId, x, s.target, speedUnitOf(S))).join(' · ')}</span>
    </div>)}
    <button type="button" className="thilo-hist-more small" onClick={onOpen}>{t('Exercise history')}<Icon name="chevronRight" /></button>
  </div>
}
