// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'

// Start opens the quick weigh-in unless Settings → During a workout → "Weigh in before
// workouts" is off (issue #137) — then the session begins at once, with no body weight on it.

// Thilos Fork: the weigh-in prompt is gone for good (body weight comes from Apple Health), even
// for a profile that still has weighIn on or unset.
describe('no weigh-in prompt before a workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], bodyweight: [], weighIn: true } }))
  })

  for (const [label, weighIn] of [['on', true], ['unset', undefined], ['off', false]]) {
    it(`weighIn ${label}: Start begins the session at once, with no sheet and no body weight`, () => {
      useStore.setState(s => { const S = { ...s.S }; if (weighIn === undefined) delete S.weighIn; else S.weighIn = weighIn; return { S } })
      act(() => startFlow([]))
      expect(useUI.getState().sheets).toHaveLength(0)
      const { active } = useStore.getState().S
      expect(active).not.toBeNull()
      expect(active.bw).toBeNull()
      expect(active.routineIds).toEqual([])
    })
  }
})
