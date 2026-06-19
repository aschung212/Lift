import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REMINDER_CONFIG,
  REMINDER_ID_BASE,
  DAY_LABELS,
  toCapacitorWeekday,
  reminderNotificationIds,
  sanitizeReminderConfig,
  hasActiveReminders,
  buildReminderNotifications,
  formatReminderTime,
  summarizeReminderDays,
  type ReminderConfig,
} from '../workoutReminders'

describe('toCapacitorWeekday', () => {
  it('shifts JS weekday (0=Sun) to Capacitor weekday (1=Sun)', () => {
    expect(toCapacitorWeekday(0)).toBe(1) // Sunday
    expect(toCapacitorWeekday(6)).toBe(7) // Saturday
  })
})

describe('reminderNotificationIds', () => {
  it('returns the seven deterministic slot IDs', () => {
    expect(reminderNotificationIds()).toEqual([
      REMINDER_ID_BASE, REMINDER_ID_BASE + 1, REMINDER_ID_BASE + 2,
      REMINDER_ID_BASE + 3, REMINDER_ID_BASE + 4, REMINDER_ID_BASE + 5,
      REMINDER_ID_BASE + 6,
    ])
  })
})

describe('sanitizeReminderConfig', () => {
  it('returns defaults for non-object input', () => {
    expect(sanitizeReminderConfig(null)).toEqual(DEFAULT_REMINDER_CONFIG)
    expect(sanitizeReminderConfig('nope')).toEqual(DEFAULT_REMINDER_CONFIG)
    expect(sanitizeReminderConfig([1, 2, 3])).toEqual(DEFAULT_REMINDER_CONFIG)
  })

  it('dedupes and sorts days, dropping out-of-range and non-integer values', () => {
    const result = sanitizeReminderConfig({
      enabled: true,
      days: [5, 1, 1, 3, 7, -1, 2.5, 'x'],
      hour: 7,
      minute: 30,
    })
    expect(result.days).toEqual([1, 3, 5])
    expect(result.enabled).toBe(true)
    expect(result.hour).toBe(7)
    expect(result.minute).toBe(30)
  })

  it('clamps and rounds hour and minute', () => {
    expect(sanitizeReminderConfig({ hour: 99, minute: -5 }).hour).toBe(23)
    expect(sanitizeReminderConfig({ hour: 99, minute: -5 }).minute).toBe(0)
    expect(sanitizeReminderConfig({ hour: 6.7, minute: 30.4 }).hour).toBe(7)
    expect(sanitizeReminderConfig({ hour: 6.7, minute: 30.4 }).minute).toBe(30)
  })

  it('falls back to default days when days is not an array', () => {
    expect(sanitizeReminderConfig({ enabled: true }).days).toEqual(DEFAULT_REMINDER_CONFIG.days)
  })

  it('accepts an empty day array (distinct from missing)', () => {
    expect(sanitizeReminderConfig({ days: [] }).days).toEqual([])
  })
})

describe('hasActiveReminders', () => {
  it('is true only when enabled with at least one day', () => {
    expect(hasActiveReminders({ enabled: true, days: [1], hour: 8, minute: 0 })).toBe(true)
    expect(hasActiveReminders({ enabled: false, days: [1], hour: 8, minute: 0 })).toBe(false)
    expect(hasActiveReminders({ enabled: true, days: [], hour: 8, minute: 0 })).toBe(false)
  })
})

describe('buildReminderNotifications', () => {
  it('returns one weekly-repeating notification per day with deterministic IDs', () => {
    const config: ReminderConfig = { enabled: true, days: [1, 5], hour: 7, minute: 15 }
    const notifications = buildReminderNotifications(config)
    expect(notifications).toHaveLength(2)

    const monday = notifications[0]
    expect(monday.id).toBe(REMINDER_ID_BASE + 1)
    expect(monday.schedule.on).toEqual({ weekday: 2, hour: 7, minute: 15 })
    expect(monday.schedule.repeats).toBe(true)
    expect(monday.schedule.allowWhileIdle).toBe(true)
    expect(monday.title).toBeTruthy()
    expect(monday.body).toBeTruthy()

    const friday = notifications[1]
    expect(friday.id).toBe(REMINDER_ID_BASE + 5)
    expect(friday.schedule.on.weekday).toBe(6)
  })

  it('returns an empty array for inactive configs', () => {
    expect(buildReminderNotifications({ enabled: false, days: [1], hour: 8, minute: 0 })).toEqual([])
    expect(buildReminderNotifications({ enabled: true, days: [], hour: 8, minute: 0 })).toEqual([])
  })

  it('gives every weekday a unique id so none collide on cancel', () => {
    const config: ReminderConfig = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0 }
    const ids = buildReminderNotifications(config).map((n) => n.id)
    expect(new Set(ids).size).toBe(7)
    expect(ids.every((id) => reminderNotificationIds().includes(id))).toBe(true)
  })
})

describe('formatReminderTime', () => {
  it('formats as a 12-hour clock', () => {
    expect(formatReminderTime(0, 0)).toBe('12:00 AM')
    expect(formatReminderTime(9, 5)).toBe('9:05 AM')
    expect(formatReminderTime(12, 0)).toBe('12:00 PM')
    expect(formatReminderTime(18, 30)).toBe('6:30 PM')
    expect(formatReminderTime(23, 59)).toBe('11:59 PM')
  })
})

describe('summarizeReminderDays', () => {
  it('summarizes common patterns', () => {
    expect(summarizeReminderDays([])).toBe('None')
    expect(summarizeReminderDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(summarizeReminderDays([1, 2, 3, 4, 5])).toBe('Weekdays')
    expect(summarizeReminderDays([0, 6])).toBe('Weekends')
    expect(summarizeReminderDays([1, 3, 5])).toBe('Mon, Wed, Fri')
  })

  it('labels every weekday', () => {
    expect(DAY_LABELS).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })
})
