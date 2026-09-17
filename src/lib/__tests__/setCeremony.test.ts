import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decideSetCeremony,
  hasCelebratedFirstSet,
  markFirstSetCelebrated,
  FIRST_SET_CELEBRATED_KEY,
  type SetCeremonyContext,
  type SetCeremonyGoal,
} from '../setCeremony'

/**
 * The exclusion matrix that used to live as four prose comments inside
 * `WorkoutTracker.saveSet` (LIFT-1448). Every row asserts BOTH halves —
 * which surface was picked and which single haptic goes with it — because the
 * two defects this replaced were a haptic mismatch, not a wrong surface.
 */

const goal = (over: Partial<SetCeremonyGoal> = {}): SetCeremonyGoal => ({
  weekKey: '2026-09-14',
  streak: 3,
  milestone: false,
  target: 4,
  ...over,
})

function ctx(over: Partial<SetCeremonyContext> = {}): SetCeremonyContext {
  return {
    wasPR: false,
    isFirstSetEver: false,
    isFirstPR: false,
    resolveGoal: () => null,
    ...over,
  }
}

describe('decideSetCeremony', () => {
  it('a routine set gets no celebration and the light tap', () => {
    expect(decideSetCeremony(ctx())).toEqual({
      celebration: 'none',
      goal: null,
      haptic: 'light',
    })
  })

  it('a PR takes the burst and the success pattern', () => {
    expect(decideSetCeremony(ctx({ wasPR: true }))).toEqual({
      celebration: 'pr',
      goal: null,
      haptic: 'success',
    })
  })

  it('a FIRST PR takes the heavier pattern', () => {
    expect(decideSetCeremony(ctx({ wasPR: true, isFirstPR: true })).haptic).toBe('heavy-success')
  })

  it('isFirstPR is ignored when the set is not a PR', () => {
    // The caller snapshots `totalPRCount === 0` unconditionally; only the PR
    // lane may read it, or a brand-new user's every save would buzz heavy.
    expect(decideSetCeremony(ctx({ isFirstPR: true }))).toEqual({
      celebration: 'none',
      goal: null,
      haptic: 'light',
    })
  })

  it('the first-ever set takes the activation card and the success pattern', () => {
    expect(decideSetCeremony(ctx({ isFirstSetEver: true }))).toEqual({
      celebration: 'first-set',
      goal: null,
      haptic: 'success',
    })
  })

  it('a due weekly goal takes the banner and the success pattern', () => {
    const due = goal()
    expect(decideSetCeremony(ctx({ resolveGoal: () => due }))).toEqual({
      celebration: 'goal',
      goal: due,
      haptic: 'success',
    })
  })

  it('a streak-tier crossing takes the heavier pattern', () => {
    const due = goal({ milestone: true })
    expect(decideSetCeremony(ctx({ resolveGoal: () => due })).haptic).toBe('heavy-success')
  })

  // ── Exclusion ────────────────────────────────────────────────────
  // Two full-screen moments must never stack, and no save may fire two haptics.

  it('a PR suppresses the first-set card', () => {
    const d = decideSetCeremony(ctx({ wasPR: true, isFirstSetEver: true }))
    expect(d.celebration).toBe('pr')
  })

  it('a PR suppresses the goal banner AND never resolves it', () => {
    // Resolving marks the week celebrated, so a PR save must not even ask —
    // otherwise the week is burned on a banner that was never shown and the
    // celebration is lost until next Monday.
    const resolveGoal = vi.fn(() => goal())
    const d = decideSetCeremony(ctx({ wasPR: true, resolveGoal }))
    expect(d.celebration).toBe('pr')
    expect(d.goal).toBeNull()
    expect(resolveGoal).not.toHaveBeenCalled()
  })

  it('the first-set card suppresses the goal banner AND never resolves it', () => {
    const resolveGoal = vi.fn(() => goal())
    const d = decideSetCeremony(ctx({ isFirstSetEver: true, resolveGoal }))
    expect(d.celebration).toBe('first-set')
    expect(resolveGoal).not.toHaveBeenCalled()
  })

  it('resolves the goal exactly once when the save reaches that lane', () => {
    const resolveGoal = vi.fn(() => goal())
    decideSetCeremony(ctx({ resolveGoal }))
    expect(resolveGoal).toHaveBeenCalledTimes(1)
  })

  it('every combination yields exactly one celebration and exactly one haptic', () => {
    const celebrations = new Set<string>()
    const haptics = new Set<string>()
    for (const wasPR of [false, true]) {
      for (const isFirstSetEver of [false, true]) {
        for (const isFirstPR of [false, true]) {
          for (const due of [null, goal(), goal({ milestone: true })]) {
            const d = decideSetCeremony(ctx({ wasPR, isFirstSetEver, isFirstPR, resolveGoal: () => due }))
            expect(['pr', 'first-set', 'goal', 'none']).toContain(d.celebration)
            expect(['light', 'success', 'heavy-success']).toContain(d.haptic)
            // The goal payload travels only with its own lane.
            expect(d.goal === null).toBe(d.celebration !== 'goal')
            celebrations.add(d.celebration)
            haptics.add(d.haptic)
          }
        }
      }
    }
    // Non-vacuity: the sweep really did reach all four lanes and all three patterns.
    expect([...celebrations].sort()).toEqual(['first-set', 'goal', 'none', 'pr'])
    expect([...haptics].sort()).toEqual(['heavy-success', 'light', 'success'])
  })
})

describe('first-set flag', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads back the bare string the flag has always been written as', () => {
    expect(hasCelebratedFirstSet()).toBe(false)
    markFirstSetCelebrated()
    // Pinned as a raw string: routing it through loadJSON would JSON.parse it
    // to a boolean, and every existing user's flag would stop matching.
    expect(localStorage.getItem(FIRST_SET_CELEBRATED_KEY)).toBe('true')
    expect(hasCelebratedFirstSet()).toBe(true)
  })

  it('treats any other stored value as not yet celebrated', () => {
    localStorage.setItem(FIRST_SET_CELEBRATED_KEY, 'false')
    expect(hasCelebratedFirstSet()).toBe(false)
  })

  it('survives a storage read that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(hasCelebratedFirstSet()).toBe(false)
    spy.mockRestore()
  })

  it('survives a storage write that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => markFirstSetCelebrated()).not.toThrow()
    spy.mockRestore()
  })
})
