/**
 * Per-field guards for the three preferences-blob sub-objects that never had one
 * (LIFT-1493): `features`, `experience` and `filters`.
 *
 * Every other field in that blob already crosses the boundary through a
 * sanitizer or an inline `typeof` check — `_migrateWeightGoal`,
 * `sanitizeCoachProfile`, `sanitizeGymList`, `sanitizeIntensityPresets`,
 * `sanitizeStrengthBaselineMode`. These three were spread onto state raw
 * (`{ ...DEFAULT_EXPERIENCE, ...(parsed.experience as Partial<ExperienceFlags>) }`),
 * which is exactly what the repo's boundary rule forbids (LIFT-946: no
 * `JSON.parse` result may be cast to a domain type without passing through a
 * guard). `user_preferences` is the last-write-wins blob with NO reconciliation
 * pass, so whatever hydrates is re-persisted locally by `_persistLocal` and
 * pushed back by `_persist` — a corrupt value doesn't merely land on one
 * device, it launders itself onto every device the account touches.
 *
 * SPREADING is what turns a wrong type into a dangerous one, and each of the
 * three fails differently:
 *
 *  - `features: 'abc'` spreads as character-index keys (`{ 0: 'a', 1: 'b' }`),
 *    and `enabledCount` is `Object.values(features).filter(Boolean).length` —
 *    so `toggleFeature`'s "you can't disable your last tab" guard reads six
 *    enabled tabs where there are three, and the user can switch all three off
 *    and be left with an empty tab bar (App.vue renders `visibleTabs` from the
 *    same map). Hence the container must be a plain OBJECT, not merely
 *    spreadable: an array corrupts the same way.
 *  - `filters.warmupThreshold: '0.75'` makes every `ratio < threshold`
 *    comparison false, so warmup classification silently stops happening, and
 *    Settings renders `Math.round(t * 100)` as "NaN%" with `aria-valuenow="NaN"`.
 *  - `experience.haptics: 'false'` is TRUTHY, so an opt-OUT reads as an opt-in
 *    at every consumer — the one direction of that mistake a user notices.
 *
 * Shape and defaults live here with the guards, the way the blob's other fields
 * already do (`coachProfile.ts`, `strengthBaseline.ts`, `gyms.ts`,
 * `intensityTable.ts`): a default the guard can't see is a default that drifts.
 * The store re-exports the three types so its public surface is unchanged.
 */
import { logWarn } from './logger'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Feature flags (tab visibility) ────────────────────────────────

export interface FeatureFlags {
  workouts: boolean
  calendar: boolean
  weight: boolean
  [key: string]: boolean
}

export const DEFAULT_FEATURES: FeatureFlags = {
  workouts: true,
  calendar: true,
  weight: true,
}

/**
 * Tab-visibility flags, rebuilt over the defaults.
 *
 * A key survives only when its value is a real boolean. Unknown boolean keys
 * ARE kept — the interface declares an index signature, so a flag a newer
 * client added round-trips through an older one instead of being stripped and
 * pushed straight back as a deletion.
 */
export function sanitizeFeatureFlags(value: unknown): FeatureFlags {
  if (!isPlainObject(value)) {
    logWarn('Dropping non-object feature flags during hydration', { value })
    return { ...DEFAULT_FEATURES }
  }
  const out: FeatureFlags = { ...DEFAULT_FEATURES }
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'boolean') out[key] = v
    else logWarn('Dropping non-boolean feature flag during hydration', { key, value: v })
  }
  return out
}

// ── Experience flags (celebrations, haptics, wake lock, notifications) ──

export interface ExperienceFlags {
  /**
   * Master switch for celebration moments: the full-screen PR burst when a set
   * beats the user's e1RM, and the lighter weekly-goal / streak-milestone banner.
   */
  prCelebrations: boolean
  /** Allow haptic feedback on taps, PRs, and timer end. */
  haptics: boolean
  /** Keep the screen awake during rest timer and set logging. */
  screenWakeLock: boolean
  /** Show a browser notification when the rest timer completes while the app is backgrounded. */
  restTimerNotification: boolean
}

export const DEFAULT_EXPERIENCE: ExperienceFlags = {
  prCelebrations: true,
  haptics: true,
  screenWakeLock: true,
  restTimerNotification: true,
}

/**
 * Experience flags, rebuilt field by field from the defaults (the
 * `sanitizeCoachProfile` shape). Unlike `features` this interface declares no
 * index signature, so unknown keys are dropped rather than kept — carrying a
 * key the type says cannot exist is how an untyped value reaches a consumer.
 */
export function sanitizeExperienceFlags(value: unknown): ExperienceFlags {
  if (!isPlainObject(value)) {
    logWarn('Dropping non-object experience flags during hydration', { value })
    return { ...DEFAULT_EXPERIENCE }
  }
  return {
    prCelebrations: boolOr(value.prCelebrations, DEFAULT_EXPERIENCE.prCelebrations, 'prCelebrations'),
    haptics: boolOr(value.haptics, DEFAULT_EXPERIENCE.haptics, 'haptics'),
    screenWakeLock: boolOr(value.screenWakeLock, DEFAULT_EXPERIENCE.screenWakeLock, 'screenWakeLock'),
    restTimerNotification: boolOr(value.restTimerNotification, DEFAULT_EXPERIENCE.restTimerNotification, 'restTimerNotification'),
  }
}

function boolOr(v: unknown, fallback: boolean, key: string): boolean {
  if (typeof v === 'boolean') return v
  if (v !== undefined) logWarn('Dropping non-boolean experience flag during hydration', { key, value: v })
  return fallback
}

// ── Filter settings (warmup classification) ───────────────────────

export interface FilterSettings {
  /** e1RM ratio threshold (0–1) below which a pre-top set is classified as warmup. Default 0.75 */
  warmupThreshold: number
}

export const MIN_WARMUP_THRESHOLD = 0.5
export const MAX_WARMUP_THRESHOLD = 0.95

export const DEFAULT_FILTERS: FilterSettings = {
  warmupThreshold: 0.75,
}

/**
 * The one definition of the warmup-threshold bounds, shared by the store's
 * setter and the hydration guard so a stored value and a user-set one can't be
 * held to different limits.
 */
export function clampWarmupThreshold(value: number): number {
  return Math.max(MIN_WARMUP_THRESHOLD, Math.min(MAX_WARMUP_THRESHOLD, value))
}

/**
 * Filter settings, rebuilt from the defaults.
 *
 * Deliberately stricter than a bare `typeof === 'number'`: `NaN` and `Infinity`
 * are numbers, and either one makes every `ratio < threshold` comparison false
 * — the silent failure this guard exists for. Only a finite number is accepted,
 * then clamped, matching `sanitizeRecentBaselineWeeks`.
 */
export function sanitizeFilterSettings(value: unknown): FilterSettings {
  if (!isPlainObject(value)) {
    logWarn('Dropping non-object filter settings during hydration', { value })
    return { ...DEFAULT_FILTERS }
  }
  const threshold = value.warmupThreshold
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    if (threshold !== undefined) logWarn('Dropping non-finite warmup threshold during hydration', { value: threshold })
    return { ...DEFAULT_FILTERS }
  }
  return { warmupThreshold: clampWarmupThreshold(threshold) }
}
