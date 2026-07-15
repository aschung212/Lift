/**
 * AI Coach — athlete profile (issue #931, phase A).
 *
 * The single biggest quality lever for the Coach export is CONTEXT: without the
 * athlete's sex/age/height/experience/goals/effort-style/schedule/injuries the
 * model can only produce generic observations. This module owns the profile
 * schema, its sanitizer, and the `<athlete>` block injected into every export so
 * the user supplies it ONCE (persisted + synced via the preferences store) and
 * every future review is individualized with zero back-and-forth.
 *
 * Pure by design (no browser/network) so it unit-tests directly and the same
 * `<athlete>` block is produced everywhere. Sensitive fields (age, injuries) only
 * ever leave the device when the user chooses to copy/download an export.
 *
 * VERSIONED: bump `PROFILE_VERSION` and migrate in `sanitizeCoachProfile` when the
 * field set changes — the object syncs to `user_preferences`, so a schema change
 * must tolerate old shapes.
 */

export const PROFILE_VERSION = 1

export type Sex = '' | 'male' | 'female' | 'other'
export type Experience = '' | 'beginner' | 'intermediate' | 'advanced'
export type PrimaryGoal =
  | ''
  | 'hypertrophy'
  | 'strength'
  | 'powerlifting'
  | 'general_fitness'
  | 'fat_loss'
export type Equipment = '' | 'full_gym' | 'home_gym' | 'minimal'
export type ReviewMode = 'quick_checkin' | 'deep_audit'

export interface CompetitionInfo {
  sport: string
  division: string
  timeline: string
  phase: string
}

export interface CoachProfile {
  version: number
  sex: Sex
  age: number | null
  /** Free text ("5'6\"" or "168 cm") — avoids a height-unit toggle; the model reads either. */
  height: string
  experience: Experience
  primaryGoal: PrimaryGoal
  /** Free text: lagging/priority muscles or lifts, e.g. "side delts, hamstrings". */
  prioritiesLagging: string
  /** Free text: to failure? typical RIR? how they progress. */
  effortStyle: string
  daysPerWeek: number | null
  sessionLenMin: number | null
  /** Free text: injuries, limitations, movements to avoid. */
  injuries: string
  equipment: Equipment
  competing: boolean
  competition: CompetitionInfo
  reviewMode: ReviewMode
}

export const DEFAULT_COMPETITION: CompetitionInfo = {
  sport: '',
  division: '',
  timeline: '',
  phase: '',
}

export const DEFAULT_COACH_PROFILE: CoachProfile = {
  version: PROFILE_VERSION,
  sex: '',
  age: null,
  height: '',
  experience: '',
  primaryGoal: '',
  prioritiesLagging: '',
  effortStyle: '',
  daysPerWeek: null,
  sessionLenMin: null,
  injuries: '',
  equipment: '',
  competing: false,
  competition: { ...DEFAULT_COMPETITION },
  reviewMode: 'deep_audit',
}

const SEX_VALUES: ReadonlySet<string> = new Set(['male', 'female', 'other'])
const EXPERIENCE_VALUES: ReadonlySet<string> = new Set(['beginner', 'intermediate', 'advanced'])
const GOAL_VALUES: ReadonlySet<string> = new Set([
  'hypertrophy',
  'strength',
  'powerlifting',
  'general_fitness',
  'fat_loss',
])
const EQUIPMENT_VALUES: ReadonlySet<string> = new Set(['full_gym', 'home_gym', 'minimal'])
const REVIEW_MODES: ReadonlySet<string> = new Set(['quick_checkin', 'deep_audit'])

/** Field-name → cap; free-text is bounded so a pasted essay can't bloat the payload. */
const TEXT_MAX = 400

function cleanText(value: unknown, max = TEXT_MAX): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function cleanInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < min || i > max) return null
  return i
}

function cleanEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback
}

/**
 * Coerce any stored/remote shape into a valid CoachProfile. Never throws — a
 * corrupt or partial blob degrades to defaults field-by-field.
 */
export function sanitizeCoachProfile(raw: unknown): CoachProfile {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const comp = (o.competition && typeof o.competition === 'object' ? o.competition : {}) as Record<
    string,
    unknown
  >
  return {
    version: PROFILE_VERSION,
    sex: cleanEnum(o.sex, SEX_VALUES, ''),
    age: cleanInt(o.age, 12, 100),
    height: cleanText(o.height, 40),
    experience: cleanEnum(o.experience, EXPERIENCE_VALUES, ''),
    primaryGoal: cleanEnum(o.primaryGoal, GOAL_VALUES, ''),
    prioritiesLagging: cleanText(o.prioritiesLagging),
    effortStyle: cleanText(o.effortStyle),
    daysPerWeek: cleanInt(o.daysPerWeek, 1, 14),
    sessionLenMin: cleanInt(o.sessionLenMin, 10, 360),
    injuries: cleanText(o.injuries),
    equipment: cleanEnum(o.equipment, EQUIPMENT_VALUES, ''),
    competing: o.competing === true,
    competition: {
      sport: cleanText(comp.sport, 60),
      division: cleanText(comp.division, 60),
      timeline: cleanText(comp.timeline, 60),
      phase: cleanText(comp.phase, 60),
    },
    reviewMode: cleanEnum(o.reviewMode, REVIEW_MODES, 'deep_audit'),
  }
}

/**
 * The profile fields that meaningfully improve the review, for a "N/total added"
 * completeness meter. `reviewMode`/`version` are excluded (always set); competition
 * counts once and only when `competing`.
 */
const CORE_FIELDS: (keyof CoachProfile)[] = [
  'sex',
  'age',
  'height',
  'experience',
  'primaryGoal',
  'prioritiesLagging',
  'effortStyle',
  'daysPerWeek',
  'sessionLenMin',
  'injuries',
  'equipment',
]

export interface ProfileCompleteness {
  filled: number
  total: number
}

export function profileCompleteness(p: CoachProfile): ProfileCompleteness {
  let filled = 0
  for (const key of CORE_FIELDS) {
    const v = p[key]
    if (typeof v === 'number' && v !== null) filled++
    else if (typeof v === 'string' && v.trim() !== '') filled++
  }
  // Competition counts as one field, credited when the athlete is competing and
  // has named at least the sport.
  const total = CORE_FIELDS.length + 1
  if (p.competing && p.competition.sport.trim() !== '') filled++
  return { filled, total }
}

/** True when nothing individualizing has been supplied (so the export can skip the block). */
export function isProfileEmpty(p: CoachProfile): boolean {
  return profileCompleteness(p).filled === 0
}

/**
 * Serialize the profile into the `<athlete>` block for the export. Empty fields
 * are OMITTED so a sparse profile stays clean and the prompt's "state your
 * assumption and proceed, then list what would sharpen it" path engages. Always
 * carries `review_mode`. Returns '' when the profile is empty.
 */
export function buildAthleteBlock(p: CoachProfile): string {
  const out: Record<string, unknown> = {}
  if (p.sex) out.sex = p.sex
  if (p.age !== null) out.age = p.age
  if (p.height) out.height = p.height
  if (p.experience) out.experience = p.experience
  if (p.primaryGoal) out.primary_goal = p.primaryGoal
  if (p.prioritiesLagging) out.priorities_lagging = p.prioritiesLagging
  if (p.effortStyle) out.effort_style = p.effortStyle
  if (p.daysPerWeek !== null || p.sessionLenMin !== null) {
    out.schedule = {
      ...(p.daysPerWeek !== null ? { days_per_week: p.daysPerWeek } : {}),
      ...(p.sessionLenMin !== null ? { session_len_min: p.sessionLenMin } : {}),
    }
  }
  if (p.injuries) out.injuries = p.injuries
  if (p.equipment) out.equipment = p.equipment
  if (p.competing && p.competition.sport) {
    out.competition = {
      sport: p.competition.sport,
      ...(p.competition.division ? { divisions: p.competition.division } : {}),
      ...(p.competition.timeline ? { timeline: p.competition.timeline } : {}),
      ...(p.competition.phase ? { phase: p.competition.phase } : {}),
    }
  }
  // review_mode always travels so the model knows the requested depth.
  out.review_mode = p.reviewMode
  return `<athlete>\n${JSON.stringify(out)}\n</athlete>`
}
