/**
 * usePromptArbiter — the single gate in front of peak-moment prompts (LIFT-1202).
 *
 * Callers pass the prompts that are competing for a satisfaction moment, each
 * with its own eligibility flag and a `fire` action. The arbiter picks at most
 * ONE (highest priority, respecting the global cross-session cooldown), records
 * that a prompt was shown, and invokes only the winner's `fire`. Everything
 * else stays silent, so a single set save can never fan out into a review +
 * share + supporter pile-up.
 *
 * The decision + persistence logic lives in `src/lib/promptArbiter.ts`; this
 * composable only wires the two together and owns the side effect of firing.
 */

import { readArbiterState, writeArbiterState, decidePrompt } from '../lib/promptArbiter'
import type { PromptKind } from '../lib/promptArbiter'

export interface ArbiterCandidate {
  kind: PromptKind
  /** Whether this prompt's own policy permits it to fire at this moment. */
  eligible: boolean
  /** Show the prompt. Only the winning candidate's `fire` is invoked. */
  fire: () => void
}

export interface UsePromptArbiterReturn {
  /**
   * Arbitrate a peak moment. Fires at most one candidate and returns the kind
   * shown, or null when the cooldown is active or nothing was eligible.
   */
  arbitrate: (candidates: ArbiterCandidate[], now?: number) => PromptKind | null
}

export function usePromptArbiter(): UsePromptArbiterReturn {
  function arbitrate(candidates: ArbiterCandidate[], now: number = Date.now()): PromptKind | null {
    const winner = decidePrompt(candidates, readArbiterState(), now)
    if (!winner) return null
    const chosen = candidates.find(c => c.kind === winner)
    if (!chosen) return null

    // Record before firing so a slow/throwing prompt can't be retried within
    // the cooldown by a subsequent peak moment (mirrors useAppReview's policy).
    writeArbiterState({ lastShownAt: now })
    chosen.fire()
    return winner
  }

  return { arbitrate }
}
