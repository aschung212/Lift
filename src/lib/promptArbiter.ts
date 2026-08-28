/**
 * Peak-moment prompt arbiter (LIFT-1202).
 *
 * Several high-value prompts want to fire at the same satisfaction moments — a
 * new PR, a theme unlock, a streak/volume milestone: the App Store review
 * request (LIFT-602), a contextual share prompt (LIFT-716), and a Supporter
 * upsell nudge. Firing two or three of them back-to-back off a single set save
 * is exactly the collision already documented for haptics (LIFT-778) and would
 * feel spammy — the app's whole posture is "no nagging".
 *
 * This module is the single coordination point: given the candidate prompts
 * that are individually eligible at a moment, it picks AT MOST ONE by priority
 * and enforces a global cross-session cooldown so peak moments in quick
 * succession (e.g. a set that is both a PR and unlocks a theme) can't stack.
 * Each prompt kind keeps its OWN policy (Apple's per-year review caps, per-week
 * share limits, etc.); the arbiter only decides which single one — if any — is
 * allowed to surface right now.
 *
 * The bookkeeping is intentionally device-local (like the overload nudge and
 * goal celebration) — a momentary per-device experience, not synced account
 * state.
 */

import { loadJSON, isPlainObject } from './storage'

/**
 * The high-value prompts that compete for a peak moment. Ordered by intent:
 *   - `review`   — Apple caps this to 3/year and 14 days apart, so when it is
 *                  eligible it is rare and precious; it wins.
 *   - `share`    — growth (UGC); fires when review is spent or unavailable.
 *   - `supporter`— the monetization ask is the most intrusive, so it never
 *                  pre-empts a review or share opportunity.
 */
export type PromptKind = 'review' | 'share' | 'supporter'

const PROMPT_PRIORITY: Record<PromptKind, number> = {
  review: 3,
  share: 2,
  supporter: 1,
}

export interface PromptCandidate {
  kind: PromptKind
  /** Whether this prompt's OWN policy permits it to fire at this moment. */
  eligible: boolean
}

/** Device-local localStorage key holding the last-shown timestamp. */
export const PROMPT_ARBITER_KEY = 'prompt-arbiter-state'

/**
 * Minimum spacing between any two arbitrated prompts (~1/day). Guards against
 * two peak moments in one session (or across a short window) each surfacing a
 * prompt of a different kind — the collision this arbiter exists to prevent.
 */
export const MIN_MS_BETWEEN_PROMPTS = 20 * 60 * 60 * 1000

export interface PromptArbiterState {
  /** ms timestamp of the last arbitrated prompt shown, or 0 if none. */
  lastShownAt: number
}

const FRESH_STATE: PromptArbiterState = { lastShownAt: 0 }

/** Read the device-local arbiter state (corrupt/partial state falls back to fresh). */
export function readArbiterState(): PromptArbiterState {
  const parsed = loadJSON<Partial<PromptArbiterState>>(PROMPT_ARBITER_KEY, {}, isPlainObject)
  const lastShownAt =
    typeof parsed.lastShownAt === 'number' && parsed.lastShownAt >= 0 ? parsed.lastShownAt : 0
  return { lastShownAt }
}

/** Persist the arbiter state. Best-effort — a failed write just relaxes the cooldown. */
export function writeArbiterState(state: PromptArbiterState): void {
  try {
    localStorage.setItem(PROMPT_ARBITER_KEY, JSON.stringify(state))
  } catch {
    /* best-effort */
  }
}

/**
 * Decide which single prompt (if any) may fire now.
 *
 * Returns the highest-priority eligible candidate, or null when the global
 * cooldown is still active or nothing is eligible. Pure — never mutates state.
 */
export function decidePrompt(
  candidates: PromptCandidate[],
  state: PromptArbiterState = FRESH_STATE,
  now: number = Date.now(),
): PromptKind | null {
  if (state.lastShownAt > 0 && now - state.lastShownAt < MIN_MS_BETWEEN_PROMPTS) {
    return null
  }
  const eligible = candidates.filter(c => c.eligible)
  if (eligible.length === 0) return null
  eligible.sort((a, b) => PROMPT_PRIORITY[b.kind] - PROMPT_PRIORITY[a.kind])
  return eligible[0].kind
}
