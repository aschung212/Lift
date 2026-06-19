import { describe, it, expect, vi, beforeEach } from 'vitest'
import { REMINDER_ID_BASE, type ReminderConfig } from '../../lib/workoutReminders'

// Native bridge spies — keep tests independent of the Capacitor plugin.
const notificationsSupported = vi.fn(() => true)
const ensureNotificationPermission = vi.fn(() => Promise.resolve(true))
const cancelNotifications = vi.fn(() => Promise.resolve())
const scheduleNotifications = vi.fn(() => Promise.resolve(true))

vi.mock('../../lib/localNotifications', () => ({
  notificationsSupported: () => notificationsSupported(),
  ensureNotificationPermission: () => ensureNotificationPermission(),
  cancelNotifications: (ids: number[]) => cancelNotifications(ids),
  scheduleNotifications: (n: unknown) => scheduleNotifications(n),
}))

let useWorkoutReminders: typeof import('../useWorkoutReminders').useWorkoutReminders

beforeEach(async () => {
  vi.clearAllMocks()
  notificationsSupported.mockReturnValue(true)
  ensureNotificationPermission.mockResolvedValue(true)
  scheduleNotifications.mockResolvedValue(true)
  const mod = await import('../useWorkoutReminders')
  useWorkoutReminders = mod.useWorkoutReminders
})

const activeConfig: ReminderConfig = { enabled: true, days: [1, 3], hour: 7, minute: 0 }

describe('useWorkoutReminders.syncReminders', () => {
  it('no-ops on web (unsupported platform)', async () => {
    notificationsSupported.mockReturnValue(false)
    const { syncReminders } = useWorkoutReminders()
    expect(await syncReminders(activeConfig)).toBe('unsupported')
    expect(cancelNotifications).not.toHaveBeenCalled()
    expect(scheduleNotifications).not.toHaveBeenCalled()
  })

  it('cancels all slots before scheduling so de-selected days are cleared', async () => {
    const { syncReminders } = useWorkoutReminders()
    const result = await syncReminders(activeConfig)
    expect(result).toBe('scheduled')
    // Cancels the full seven-slot range first.
    expect(cancelNotifications).toHaveBeenCalledWith([
      REMINDER_ID_BASE, REMINDER_ID_BASE + 1, REMINDER_ID_BASE + 2,
      REMINDER_ID_BASE + 3, REMINDER_ID_BASE + 4, REMINDER_ID_BASE + 5,
      REMINDER_ID_BASE + 6,
    ])
    const scheduled = scheduleNotifications.mock.calls[0][0] as { id: number }[]
    expect(scheduled.map((n) => n.id)).toEqual([REMINDER_ID_BASE + 1, REMINDER_ID_BASE + 3])
  })

  it('clears (cancel only) when the config is inactive', async () => {
    const { syncReminders } = useWorkoutReminders()
    const result = await syncReminders({ ...activeConfig, enabled: false })
    expect(result).toBe('cleared')
    expect(cancelNotifications).toHaveBeenCalledTimes(1)
    expect(ensureNotificationPermission).not.toHaveBeenCalled()
    expect(scheduleNotifications).not.toHaveBeenCalled()
  })

  it('does not schedule when permission is denied', async () => {
    ensureNotificationPermission.mockResolvedValue(false)
    const { syncReminders } = useWorkoutReminders()
    const result = await syncReminders(activeConfig)
    expect(result).toBe('permission-denied')
    expect(cancelNotifications).toHaveBeenCalledTimes(1)
    expect(scheduleNotifications).not.toHaveBeenCalled()
  })

  it('reports support state', () => {
    expect(useWorkoutReminders().isSupported()).toBe(true)
    notificationsSupported.mockReturnValue(false)
    expect(useWorkoutReminders().isSupported()).toBe(false)
  })
})
