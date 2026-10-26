// The entry a swap puts in place of one exercise of the running session: the manual swap
// (sheets.jsx swapActiveWorkoutExercise) and the Coach's live swap (lib/coach-live.js, Thilo's
// fork) build it here, so the two cannot drift apart.
import { buildSets, applyIntensifierPlan, modeOf } from './history.js'
import { weightIncrement, defaultIncrement } from './progression.js'
import { sessionHistory } from './backfill.js'
import { withMeaning, historyAs, dbLoadFor, ownedWeightsFor } from './dumbbells.js'
import { dropGrid } from './plates.js'
import { buildPlannedEntry, builtOutOfProgression } from './session-start.js'

/**
 * The replacement for `current` (an entry of `st.active`) with exercise `exId` set up as `cfg`.
 * Passed to swapActiveExercise.
 */
export function buildSwapReplacement(st, current, exId, cfg) {
  const full = { ...cfg, id: exId }
  // A swap is an in-place substitution — routine identity is unchanged, so the replacement
  // keeps the slot's own `rid` and reads its prescription from that routine (not a
  // session-wide one). A slot with no `rid` is freestyle.
  const slotRoutine = current?.rid ? (st.routines || []).find(r => r.id === current.rid) : null
  const freestyle = !slotRoutine
  // Same rows the add flow builds: last time's loads and, in a planned session, the
  // prescription — swapping barbell for dumbbell bench must not start you at an empty bar.
  // Built from what came before the session's day when it is logged into the past (sessionHistory).
  const step = modeOf(full) === 'reps' ? weightIncrement(full, st.unit) : defaultIncrement(exId, st.unit)
  const past = sessionHistory(st)
  // A freestyle swap logs dumbbell weights the way the exercise means them now, and starts
  // from last time read in that meaning (lib/dumbbells.js), as a planned one does.
  const built = freestyle
    ? { target: withMeaning(st, cfg, exId), plan: null, sets: applyIntensifierPlan(buildSets(historyAs(past, exId, dbLoadFor(st, full)), full, { step: (modeOf(full) === 'reps' && ownedWeightsFor(st, full)) || step, preferLast: true }), full, dropGrid(st, full)) }
    : buildPlannedEntry(past, full, slotRoutine, { noProg: builtOutOfProgression(current, slotRoutine) })
  return {
    id: exId,
    ...built,
    ...(current?.rid ? { rid: current.rid } : {}),
    // A slot kept out of progression stays out once swapped. Replaced in place the entry keeps
    // it anyway; inserted beside logged sets, the replacement would otherwise count as a
    // regular session of the new exercise. Only a deload or rehab slot is built without a
    // prescription (above): one kept out by hand keeps the marker and its Undo on the card,
    // and an Undo must leave numbers that are right to count.
    ...(current?.noProg === true ? { noProg: true } : {}),
  }
}
