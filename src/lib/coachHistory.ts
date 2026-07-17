/**
 * AI Coach — device-local insight history (LIFT-851, part of #842).
 *
 * Each generated Weekly Review costs a quota slot and real money to produce, so
 * once a review exists it should not evaporate. This module persists generated
 * reviews to localStorage as a bounded **last-12 ring** (drop oldest), turning the
 * coach into an accruing coaching journal: re-opening a past insight is FREE — it
 * reads from this store and never touches the server quota.
 *
 * The history is intentionally **device-local** (like the overload nudge and goal
 * celebration), NOT synced. Cross-device `coach_insights` sync is a deliberate
 * Phase 2 change because it would re-trigger a consent-version bump, deleteAccount
 * wiring, and an App Store privacy-label review (see docs/ai-coach.md, History).
 *
 * The ring is capped at COACH_HISTORY_LIMIT so a long-lived PWA can never grow this
 * key without bound and trip storage-quota eviction of more important data.
 *
 * Pure + storage-only (no Vue, no network) so it is unit-testable and reusable by
 * both the CoachSheet UI and any future surface. The persisted review is the
 * already-sanitized output of `sanitizeCoachOutput`, so reads stay safe to render.
 */

import { loadJSON, isPlainObject } from './storage'
import type { CoachReview, CoachSection, CoachSectionType } from './aiCoach'

/** Device-local localStorage key holding the insight ring. Cleared on account deletion. */
export const COACH_HISTORY_KEY = 'coach-insights-history'

/** Ring capacity. Bounded so the PWA can't grow this key without limit. */
export const COACH_HISTORY_LIMIT = 12

/** One persisted Weekly Review plus the metadata needed to list and re-open it. */
export interface StoredCoachInsight {
  /** Stable unique id (for list keys + dedupe). */
  id: string
  /** Epoch milliseconds the review was generated. Drives the "Past insights" ordering + labels. */
  createdAt: number
  /** The sanitized review exactly as it was rendered when generated. */
  review: CoachReview
}

const SECTION_TYPES: readonly CoachSectionType[] = ['progress', 'volume', 'consistency', 'focus']

function isCoachSection(value: unknown): value is CoachSection {
  if (!isPlainObject(value)) return false
  const s = value as Record<string, unknown>
  if (typeof s.title !== 'string' || typeof s.body !== 'string') return false
  if (!SECTION_TYPES.includes(s.type as CoachSectionType)) return false
  if (s.metric !== undefined) {
    if (!isPlainObject(s.metric)) return false
    const m = s.metric as Record<string, unknown>
    if (typeof m.label !== 'string' || typeof m.value !== 'string') return false
  }
  return true
}

function isCoachReview(value: unknown): value is CoachReview {
  if (!isPlainObject(value)) return false
  const r = value as Record<string, unknown>
  if (typeof r.headline !== 'string' || typeof r.focusNext !== 'string') return false
  if (!Array.isArray(r.sections)) return false
  return r.sections.every(isCoachSection)
}

function isStoredInsight(value: unknown): value is StoredCoachInsight {
  if (!isPlainObject(value)) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.createdAt === 'number' &&
    Number.isFinite(e.createdAt) &&
    isCoachReview(e.review)
  )
}

/**
 * Read the persisted insight ring, newest-first. Corrupt storage or malformed
 * entries are dropped silently (never thrown into a render), and the result is
 * defensively capped to COACH_HISTORY_LIMIT in case an older build wrote more.
 */
export function loadCoachHistory(): StoredCoachInsight[] {
  const raw = loadJSON<unknown[]>(COACH_HISTORY_KEY, [], Array.isArray)
  return raw.filter(isStoredInsight).slice(0, COACH_HISTORY_LIMIT)
}

function persist(history: StoredCoachInsight[]): void {
  try {
    localStorage.setItem(COACH_HISTORY_KEY, JSON.stringify(history))
  } catch {
    /* quota / private-mode — history is best-effort, never block the UI */
  }
}

function makeId(now: number): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to the timestamp id */
  }
  return `${now}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Prepend a freshly generated review to the ring, evicting the oldest beyond
 * COACH_HISTORY_LIMIT, persist, and return the new newest-first list. Pure aside
 * from the localStorage write; pass `now` for deterministic tests.
 */
export function appendCoachInsight(
  review: CoachReview,
  now: number = Date.now(),
): StoredCoachInsight[] {
  const entry: StoredCoachInsight = { id: makeId(now), createdAt: now, review }
  const next = [entry, ...loadCoachHistory()].slice(0, COACH_HISTORY_LIMIT)
  persist(next)
  return next
}

/** Drop the entire ring (account deletion / sign-out). */
export function clearCoachHistory(): void {
  try {
    localStorage.removeItem(COACH_HISTORY_KEY)
  } catch {
    /* ignore */
  }
}
