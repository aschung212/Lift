/**
 * #1272 — XP calibration follows the strength baseline mode.
 *
 * The issue's core complaint is economic, not cosmetic: baselining off a
 * peak-bulk PR gets less meaningful the longer a cut runs, so PR detection goes
 * quiet and every set collapses into the working zone. This file pins the
 * end-to-end path that fixes it — `resolveStrengthBaseline` produces a day key,
 * `scoreSet` consumes it as `baseline`, and the SAME set scores differently
 * under each mode.
 *
 * These are the two functions the frozen-clock invariant (#1254) names:
 * `calculateBest1RM` (inside `scoreSet`) measures its fallback window from
 * `Date.now()`, so the clock is pinned and every fixture date is stated
 * relative to that frozen now.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { scoreSet } from '../setScoring'
import { XP_CONFIG } from '../xp'
import { resolveStrengthBaseline } from '../strengthBaseline'
import type { WorkoutSet } from '../../stores/workout'

const TODAY_KEY = '2026-08-30'
const NOW = `${TODAY_KEY}T12:00:00Z`

function makeSet(date: string, estimated1RM: number, weight = 100, reps = 5): WorkoutSet {
  return { id: `set-${date}-${estimated1RM}`, date: `${date}T12:00:00Z`, weight, reps, estimated1RM }
}

/**
 * A lifter mid-cut. The April peak sits INSIDE the 6-month rolling window that
 * a null baseline falls back to, so lifetime mode really does measure against
 * it — the contrast below is between the two modes, not between two windows
 * that both happen to have expired.
 */
const BULK_PEAK = 367
const RECENT_BEST = 320
const priorSets: WorkoutSet[] = [
  makeSet('2026-04-15', BULK_PEAK, 315, 5), // peak bulk, ~4.5 months ago
  makeSet('2026-05-02', 360, 310, 5),
  makeSet('2026-07-20', 315, 270, 5),       // cut underway, inside an 8-week window
  makeSet('2026-08-10', RECENT_BEST, 275, 5),
]

const lifetimeBaseline = resolveStrengthBaseline({
  mode: 'lifetime', anchor: null, weeks: 8, todayKey: TODAY_KEY,
})
const recentBaseline = resolveStrengthBaseline({
  mode: 'recent', anchor: null, weeks: 8, todayKey: TODAY_KEY,
})

function score(estimated1RM: number, baseline: string | null, weightLbs = 275, reps = 5) {
  return scoreSet({ priorSets, estimated1RM, weightLbs, reps, dateKey: TODAY_KEY, baseline })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('strength baseline mode — XP calibration (#1272)', () => {
  it('the two modes resolve to different baselines for this fixture', () => {
    expect(lifetimeBaseline).toBeNull()
    expect(recentBaseline).toBe('2026-07-05')
  })

  it('lifetime mode anchors on the bulk peak; recent mode on recent work', () => {
    expect(score(321, lifetimeBaseline).best1RM).toBe(BULK_PEAK)
    expect(score(321, recentBaseline).best1RM).toBe(RECENT_BEST)
  })

  it('a set that edges recent work is a PR in recent mode and a working set in lifetime mode', () => {
    const cutSet = RECENT_BEST + 1

    const lifetime = score(cutSet, lifetimeBaseline)
    expect(lifetime.isPR).toBe(false)
    expect(lifetime.zone).toBe('working')

    const recent = score(cutSet, recentBaseline)
    expect(recent.isPR).toBe(true)
    expect(recent.zone).toBe('pr')
  })

  it('and that PR pays multiplied XP instead of mid-working-zone XP', () => {
    const cutSet = RECENT_BEST + 1
    const lifetimeXP = score(cutSet, lifetimeBaseline).baseXP
    const recentXP = score(cutSet, recentBaseline).baseXP

    // Lifetime: ratio ≈ 0.875 of the bulk peak → linear working zone.
    expect(lifetimeXP).toBeLessThan(100)
    // Recent: ratio > 1 → prMultiplier.
    expect(recentXP).toBeGreaterThan(XP_CONFIG.prMultiplier * 100)
    expect(recentXP).toBeGreaterThan(lifetimeXP * 3)
  })

  it('equaling recent work is a tie — the "maintaining" case the issue asks for', () => {
    const recent = score(RECENT_BEST, recentBaseline)
    expect(recent.isTie).toBe(true)
    expect(recent.zone).toBe('tie')
    expect(recent.baseXP).toBe(100 * XP_CONFIG.tieMultiplier)

    // The same set against the bulk peak is unremarkable.
    expect(score(RECENT_BEST, lifetimeBaseline).zone).toBe('working')
  })

  it('recent mode does not hand out PRs for genuinely light work', () => {
    const warmup = score(150, recentBaseline, 135, 5)
    expect(warmup.isPR).toBe(false)
    expect(warmup.zone).toBe('warmup')
    expect(warmup.baseXP).toBe(XP_CONFIG.warmupFlatXP)
  })

  it('a true lifetime PR still scores as a PR in recent mode', () => {
    // Recent mode lowers the bar; it never raises it, so a set beating the
    // all-time peak clears the recent one too.
    const monster = BULK_PEAK + 10
    expect(score(monster, lifetimeBaseline).isPR).toBe(true)
    expect(score(monster, recentBaseline).isPR).toBe(true)
  })

  it('a manual training-block anchor newer than the window still governs recent mode', () => {
    // Block started 2026-08-15 — after the 8-week window start, so it is the
    // tighter floor and the 2026-08-10 set drops out of the baseline entirely.
    const blocked = resolveStrengthBaseline({
      mode: 'recent', anchor: '2026-08-15', weeks: 8, todayKey: TODAY_KEY,
    })
    expect(blocked).toBe('2026-08-15')
    // Nothing logged since the block start, so there is no established best and
    // the exercise scores as new — identical to how the anchor behaves alone.
    expect(score(300, blocked).best1RM).toBeNull()
    expect(score(300, blocked).zone).toBe('new_exercise')
  })

  it('per-weight history is evaluated against the same baseline-relative window', () => {
    // `scoreSet` filters rep-PR / prior-weight lookups through
    // `filterSetsSinceBaseline`, so those must move with the mode too — the
    // baseline can't govern the e1RM best while a second window governs the
    // per-weight history.
    const beforeWindow = scoreSet({
      priorSets, estimated1RM: 300, weightLbs: 315, reps: 3,
      dateKey: TODAY_KEY, baseline: recentBaseline,
    })
    // The only 315 lb set is from April, outside the recent window — so there is
    // no rep record at that weight to beat, and this reads as a new weight.
    expect(beforeWindow.isRepPR).toBe(false)
    expect(beforeWindow.isNewWeight).toBe(true)

    // Under lifetime mode the April set IS in scope, so 315 is not a new weight.
    const allTime = scoreSet({
      priorSets, estimated1RM: 300, weightLbs: 315, reps: 3,
      dateKey: TODAY_KEY, baseline: lifetimeBaseline,
    })
    expect(allTime.isNewWeight).toBe(false)
  })
})
