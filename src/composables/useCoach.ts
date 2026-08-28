/**
 * AI Coach — UI state composable (issue LIFT-848).
 *
 * A module-scope SINGLETON (like usePRBurst / useGoalCelebration) so the Workouts
 * entry card and the CoachSheet share one source of truth: the card reads
 * `remaining` for its quota meter, the sheet drives `generate()` and renders off
 * `state`. The server is the real cap; `remaining`/`resetsAt` are reconciled from
 * each server response and cached device-local only so the card shows a sane
 * number before the first request of a session (cosmetic, per docs/ai-coach.md).
 *
 * No persistence of the review text here — Phase-1 history (#851) is a separate,
 * deliberately-bounded follow-up. This composable holds only transient UI state.
 */

import { ref, computed, type ComputedRef } from 'vue'
import { supabase } from '../lib/supabase'
import { isNative } from '../lib/platform'
import {
  requestCoachReview,
  daysUntilReset,
  type CoachResult,
  type CoachErrorKind,
} from '../lib/coachClient'
import type { CoachPayload, CoachReview } from '../lib/aiCoach'
import { loadJSON, isPlainObject } from '../lib/storage'

export type CoachState = 'idle' | 'loading' | 'result' | 'error'

/** Device-local, cosmetic quota cache. The server response is authoritative. */
const QUOTA_KEY = 'coach-quota-state'

interface QuotaCache {
  remaining: number
  resetsAt: string | null
}

const state = ref<CoachState>('idle')
const review = ref<CoachReview | null>(null)
const errorKind = ref<CoachErrorKind | null>(null)
const errorRetryable = ref(false)
const remaining = ref<number | null>(null)
const resetsAt = ref<string | null>(null)

let hydrated = false
function hydrateQuota(): void {
  if (hydrated) return
  hydrated = true
  const cached = loadJSON<QuotaCache | null>(QUOTA_KEY, null, isPlainObject)
  if (cached && typeof cached.remaining === 'number') {
    remaining.value = cached.remaining
    resetsAt.value = typeof cached.resetsAt === 'string' ? cached.resetsAt : null
  }
}

function persistQuota(): void {
  if (remaining.value === null) return
  try {
    localStorage.setItem(
      QUOTA_KEY,
      JSON.stringify({ remaining: remaining.value, resetsAt: resetsAt.value }),
    )
  } catch {
    /* storage full / private mode — the cache is cosmetic */
  }
}

async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/** Fold a typed server result into reactive UI state. Exported for tests. */
export function applyCoachResult(result: CoachResult): void {
  if (result.ok) {
    review.value = result.review
    remaining.value = result.remaining
    resetsAt.value = result.resetsAt
    persistQuota()
    errorKind.value = null
    state.value = 'result'
    return
  }
  errorKind.value = result.kind
  errorRetryable.value = result.retryable
  if (result.kind === 'quota_exceeded') {
    remaining.value = 0
    if (result.resetsAt) resetsAt.value = result.resetsAt
    persistQuota()
  }
  state.value = 'error'
}

export interface UseCoachReturn {
  state: typeof state
  review: typeof review
  errorKind: typeof errorKind
  errorRetryable: typeof errorRetryable
  remaining: typeof remaining
  resetsAt: typeof resetsAt
  /** Whole days until the rolling quota window resets (server-accurate), or null. */
  resetDays: ComputedRef<number | null>
  /** Request a review for an already-built payload. Drives loading → result/error. */
  generate: (payload: CoachPayload) => Promise<void>
  /** Return to the idle entry state (e.g. when reopening the sheet). */
  reset: () => void
}

export function useCoach(): UseCoachReturn {
  hydrateQuota()

  const resetDays = computed<number | null>(() => daysUntilReset(resetsAt.value))

  async function generate(payload: CoachPayload): Promise<void> {
    state.value = 'loading'
    review.value = null
    errorKind.value = null
    const token = await getAccessToken()
    if (!token) {
      errorKind.value = 'unauthorized'
      errorRetryable.value = false
      state.value = 'error'
      return
    }
    const result = await requestCoachReview({ payload, token, native: isNative })
    applyCoachResult(result)
  }

  function reset(): void {
    state.value = 'idle'
    review.value = null
    errorKind.value = null
  }

  return {
    state,
    review,
    errorKind,
    errorRetryable,
    remaining,
    resetsAt,
    resetDays,
    generate,
    reset,
  }
}
