/**
 * Workout-reminder scheduling logic (pure).
 *
 * Habit formation in fitness apps hinges on an external cue: the single
 * highest-leverage first-30-day retention lever is a reliable "time to train"
 * nudge on the user's chosen days. This module owns the *what to schedule*
 * decision — config validation and the deterministic notification payloads —
 * with zero dependency on Capacitor, so it is fully unit-testable. The native
 * bridge (`src/lib/localNotifications.ts`) and orchestration
 * (`useWorkoutReminders`) consume these pure outputs.
 *
 * Days are stored in JS `Date.getDay()` convention (0 = Sunday … 6 = Saturday).
 * The Capacitor LocalNotifications `Schedule.on.weekday` field uses 1 = Sunday …
 * 7 = Saturday, so `toCapacitorWeekday` shifts by one at the boundary.
 */

/** A user's recurring workout-reminder configuration. */
export interface ReminderConfig {
  /** Master switch — when false, no reminders are scheduled. */
  enabled: boolean
  /** Days to remind, in JS weekday convention (0 = Sun … 6 = Sat), sorted & deduped. */
  days: number[]
  /** Local hour of day, 0–23. */
  hour: number
  /** Local minute of the hour, 0–59. */
  minute: number
}

/** A single platform-agnostic reminder notification ready for the native bridge. */
export interface ReminderNotification {
  id: number
  title: string
  body: string
  schedule: {
    /** Capacitor weekday (1 = Sun … 7 = Sat). */
    on: { weekday: number; hour: number; minute: number }
    repeats: true
    allowWhileIdle: true
  }
}

/**
 * Fixed ID base for reminder notifications. Each day gets `base + jsDay`, so the
 * seven possible IDs are deterministic and can be cancelled without tracking
 * state — re-syncing always cancels {@link reminderNotificationIds} first.
 */
export const REMINDER_ID_BASE = 4200

/** Default: off, Mon/Wed/Fri at 6:00 PM local. */
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: false,
  days: [1, 3, 5],
  hour: 18,
  minute: 0,
}

const NOTIFICATION_TITLE = 'Time to train'
const NOTIFICATION_BODY = "Ready for today's workout? Log a session to keep your streak going."

/** Short day labels, indexed by JS weekday (0 = Sun). */
export const DAY_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Convert a JS weekday (0 = Sun) to the Capacitor `Schedule.on.weekday` value (1 = Sun). */
export function toCapacitorWeekday(jsDay: number): number {
  return jsDay + 1
}

/** Every possible reminder notification ID (base..base+6), used to cancel before re-scheduling. */
export function reminderNotificationIds(): number[] {
  return DAY_LABELS.map((_, day) => REMINDER_ID_BASE + day)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

/**
 * Coerce arbitrary persisted/remote input into a valid {@link ReminderConfig}.
 * Invalid days are dropped; the day list is deduped and sorted; hour/minute are
 * clamped. Missing fields fall back to {@link DEFAULT_REMINDER_CONFIG}.
 */
export function sanitizeReminderConfig(raw: unknown): ReminderConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_REMINDER_CONFIG }
  }
  const obj = raw as Record<string, unknown>

  const days = Array.isArray(obj.days)
    ? Array.from(
        new Set(
          obj.days
            .filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ).sort((a, b) => a - b)
    : [...DEFAULT_REMINDER_CONFIG.days]

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_REMINDER_CONFIG.enabled,
    days,
    hour: clampInt(obj.hour, 0, 23, DEFAULT_REMINDER_CONFIG.hour),
    minute: clampInt(obj.minute, 0, 59, DEFAULT_REMINDER_CONFIG.minute),
  }
}

/**
 * Whether a config would actually result in scheduled reminders. A config that
 * is disabled or has no selected days schedules nothing (the bridge still
 * cancels any previously-scheduled notifications).
 */
export function hasActiveReminders(config: ReminderConfig): boolean {
  return config.enabled && config.days.length > 0
}

/**
 * Build the concrete weekly-repeating notifications for a config. Returns an
 * empty array when the config is inactive (disabled or no days), so callers can
 * treat "schedule these" uniformly. Each notification repeats weekly on its day
 * at the configured local time.
 */
export function buildReminderNotifications(config: ReminderConfig): ReminderNotification[] {
  if (!hasActiveReminders(config)) return []
  return config.days.map((day) => ({
    id: REMINDER_ID_BASE + day,
    title: NOTIFICATION_TITLE,
    body: NOTIFICATION_BODY,
    schedule: {
      on: { weekday: toCapacitorWeekday(day), hour: config.hour, minute: config.minute },
      repeats: true,
      allowWhileIdle: true,
    },
  }))
}

/** Format an hour/minute as a 12-hour clock string, e.g. `6:00 PM`. */
export function formatReminderTime(hour: number, minute: number): string {
  const period = hour < 12 ? 'AM' : 'PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`
}

/**
 * Human summary of the reminder days, e.g. `Every day`, `Weekdays`,
 * `Mon, Wed, Fri`, or `None`. Days are assumed already sorted/deduped.
 */
export function summarizeReminderDays(days: number[]): string {
  if (days.length === 0) return 'None'
  if (days.length === 7) return 'Every day'
  const isWeekdays = days.length === 5 && days.every((d) => d >= 1 && d <= 5)
  if (isWeekdays) return 'Weekdays'
  const isWeekends = days.length === 2 && days.includes(0) && days.includes(6)
  if (isWeekends) return 'Weekends'
  return days.map((d) => DAY_LABELS[d]).join(', ')
}
