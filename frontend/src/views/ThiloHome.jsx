// Thilos Fork: die Startseite im Powerfit-Look (thilo/docs/2026-11-09-powerfit-design.md).
// Was heute ansteht, wird gelesen wie in views/Home.jsx; das Original bleibt unverändert, damit
// Updates von dort ohne Konflikte kommen. Neu sind Aufbau und Darstellung: große Headline,
// Wochenring, Schnellzugriff und die Karte „Heutiges Training“. Stile in thilo-theme.css (.th-*).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW } from '../lib/history.js'
import { fmtNum, fmtDate, fmtDur, todayISO, isoOf, weekStartOf, weekDayOffset, weekKey, DAYS, DAYN } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { goalSheet, dayOverrideSheet, calendarSheet, startFlow, starterPlanSheet, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import { exOr } from '../lib/exercises.js'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import Elapsed from '../components/Elapsed.jsx'
import QueueRow from '../components/QueueRow.jsx'
import { Thumb } from '../components/Media.jsx'
import { queueOf, queueView, weekTally, pinState } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Zählt beim Öffnen von 0 auf `to` hoch (ease-out), ohne „Bewegung reduzieren“ sofort.
function useCountUp(to, ms = 900) {
  const [v, setV] = useState(() => (reducedMotion() ? to : 0))
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') { setV(to); return }
    let raf = 0, t0 = null
    const step = now => {
      if (t0 == null) t0 = now
      const k = Math.min(1, (now - t0) / ms)
      setV(Math.round(to * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return v
}

// Der Wochenring: erledigt von geplant. Er läuft beim Öffnen von 0 auf den Wert (CSS-Übergang).
function Ring({ pct }) {
  const R = 46, C = 2 * Math.PI * R
  const [shown, setShown] = useState(() => (reducedMotion() ? pct : 0))
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') { setShown(pct); return }
    const id = requestAnimationFrame(() => setShown(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  const n = useCountUp(pct)
  return <div className="th-ring" role="img" aria-label={t('{0}% done', pct)}>
    <svg viewBox="0 0 108 108" aria-hidden="true">
      <circle className="th-ring-bg" cx="54" cy="54" r={R} />
      <circle className="th-ring-fg" cx="54" cy="54" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
    </svg>
    <div className="th-ring-v"><b>{n}%</b><span>{t('Completed')}</span></div>
  </div>
}

function Stat({ icon, label, value }) {
  return <div className="th-stat">
    <span className="th-stat-i"><Icon name={icon} /></span>
    <div><div className="th-stat-l">{label}</div><div className="th-stat-v">{value}</div></div>
  </div>
}

function Quick({ icon, title, sub, onClick }) {
  return <button type="button" className="th-q" onClick={onClick}>
    <Icon name={icon} />
    <span className="th-q-t">{title}</span>
    <span className="th-q-s">{sub}</span>
  </button>
}

const initials = name => (name || '').trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '🏋'

export default function ThiloHome() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const trouble = useConnectionTrouble()
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const iso = todayISO()
  // Wie Home.jsx: ein Wochentag kann mehrere Routinen tragen; `routine` ist die erste.
  const todayRoutines = effectiveRoutines(S, iso)
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[iso] !== undefined && pinState(S, S.dayPlan[iso]) !== 'done'
  const editingSaved = !!S.active?.editingWorkoutId
  const loggedToday = S.workouts.filter(w => w.d === iso)
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null

  const queue = queueView(S, iso)
  const rotating = scheduleModeOf(S) === 'rotation'
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, iso) : null

  // Diese Woche: erledigt/geplant wie die Streak-Karte von Home, dazu die Trainingszeit.
  const { done: doneWeek, planned: plannedWeek } = weekTally(S, iso)
  const ws = weekStartOf(S)
  const weekMs = S.workouts.filter(w => weekKey(w.d, ws) === weekKey(iso, ws))
    .reduce((sum, w) => sum + (w.end > w.start ? w.end - w.start : 0), 0)
  const pct = plannedWeek ? Math.min(100, Math.round(doneWeek / plannedWeek * 100)) : doneWeek ? 100 : 0

  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const di = isoOf(d)
    const eff = effectiveRoutineIds(S, di).length > 0, ovr = S.dayPlan[di] !== undefined, done = doneDays.has(di)
    const dot = done ? ' done' : dayNoteOf(S, di) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (di === iso ? ' today' : '')} {...tappable(() => dayOverrideSheet(di))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // Headline: erste Zeile weiß, zweite in Lime.
  const head = S.active ? (editingSaved ? [t('Edit'), S.active.name] : [t('Workout'), t('running')])
    : doneToday ? [t('Today'), t('completed')]
    : routine ? [t('Ready for'), todayName]
    : [t('Rest day'), t('Recover')]

  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, iso)); else dayOverrideSheet(iso) }
  const onQueueStart = id => { if (S.active) nav('/workout'); else startFlow([id]) }

  // Karte „Heutiges Training“: Bild der ersten Übung, Name, Zeile darunter, runder Knopf.
  const firstId = S.active ? S.active.entries?.[0]?.id : !doneToday ? routine?.ex?.[0]?.id : null
  const firstEx = firstId ? exOr(firstId) : null
  const exCount = todayRoutines.reduce((n, r) => n + (r.ex?.length || 0), 0)
  const card = S.active
    ? { title: S.active.name, sub: editingSaved ? t('Edit workout') : S.active.start > 0 ? <Elapsed start={S.active.start} /> : t('Resume'), icon: editingSaved ? 'pencil' : 'play', cls: ' live' }
    : doneToday
      ? { title: doneToday.name || t('Workout done'), sub: [t('Done'), ...(doneToday.end > doneToday.start ? [fmtDur(doneToday.end - doneToday.start)] : [])].join(' · '), icon: 'check', cls: ' done' }
      : routine
        ? { title: todayName + (todayOvr ? ' · ' + t('rescheduled') : ''), sub: tn('{0} exercise', '{0} exercises', exCount), icon: 'play', cls: '' }
        : { title: t('Rest day'), sub: next ? t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name) : t('Plan the day'), icon: 'plus', cls: ' rest' }

  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  return <div className="narrow th-home">
    <div className="th-top">
      <div className="th-hello">
        <span className="th-ava" aria-hidden="true">{initials(user?.name)}</span>
        <span>{user ? t('Hello {0}', user.name) : 'openGym'} <span aria-hidden="true">👋</span></span>
      </div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}>
        <Icon name="more" />{trouble && <span className="tab-dot" aria-hidden="true" />}
      </button>
    </div>

    <h1 className="th-head"><span>{head[0]}</span><span className="th-head-2">{head[1]}</span></h1>

    <div className="card th-week">
      <div className="th-card-h">
        <h2>{t('This week')}</h2>
        <button type="button" className="th-link" onClick={() => nav('/plan')}>{t('Plan')}</button>
      </div>
      <div className="th-week-body">
        <Ring pct={pct} />
        <div className="th-stats">
          <Stat icon="dumbbell" label={t('Workouts')} value={plannedWeek ? `${doneWeek} / ${plannedWeek}` : String(doneWeek)} />
          <Stat icon="flame" label={t('Streak')} value={t('{0} wk', streakWeeks(S))} />
          <Stat icon="clock" label={t('Duration')} value={weekMs >= 60000 ? fmtDur(weekMs) : '–'} />
        </div>
      </div>
      {/* Wie Home.jsx: eine Coach-Woche läuft nach Reihenfolge, nicht nach Wochentag. */}
      {rotating ? (queue ? <QueueRow S={S} today={iso} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
        {t('No rotation yet. Add routines to it in Plan.')}
        <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('Set up in Plan')}</Button></div>
      </div>) : <div className="th-strip">
        <div className="row between th-strip-h">
          <button className="iconbtn" onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
          <div className="small muted">{wkLabel}</div>
          <button className="iconbtn" onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
        </div>
        <div className="week">{strip}</div>
      </div>}
    </div>

    <h4 className="th-sec">{t('Quick actions')}</h4>
    <div className="th-quick">
      <Quick icon="calendar" title={t('Calendar')} sub={t('View')} onClick={() => calendarSheet()} />
      {S.checkIn !== false
        ? <Quick icon="qr" title={t('Check in')} sub={t('At the gym')} onClick={() => nav('/checkin')} />
        : <Quick icon="clipboard" title={t('Plan')} sub={t('Schedule')} onClick={() => nav('/plan')} />}
      <Quick icon="scale" title={t('Body weight')} sub={bw ? fmtNum(bw.w) + ' ' + S.unit : t('Weigh-ins')} onClick={weighInsSheet} />
    </div>

    <h4 className="th-sec">{t("Today's workout")}</h4>
    <div className={'card tappable th-today' + card.cls} {...tappable(onToday)}>
      <div className="th-today-img">
        {firstEx && !firstEx.missing ? <Thumb ex={firstEx} /> : <Icon name={routine && !doneToday ? glyphOf(routine.emoji) : doneToday ? 'trophy' : 'moon'} />}
      </div>
      <div className="th-today-m">
        <div className="th-today-t">{card.title}</div>
        <div className="th-today-s">{card.sub}</div>
      </div>
      <span className="th-play" aria-hidden="true"><Icon name={card.icon} /></span>
    </div>
    {!S.active && <div className="th-alt">
      <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/workout')}>{t('Choose a different workout')}</Button>
    </div>}

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="calendar" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}</div>
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {S.showWeightCard !== false && <div className="card">
      <div className="row between bw-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <div className="muted small">{t('Comes automatically from Apple Health')}</div>}
    </div>}
  </div>
}
