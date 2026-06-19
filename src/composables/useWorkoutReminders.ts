/**
 * useWorkoutReminders — orchestrates recurring "time to train" reminders.
 *
 * Bridges the pure scheduling logic (`src/lib/workoutReminders.ts`) to the
 * native local-notifications plugin (`src/lib/localNotifications.ts`). The flow:
 *
 *   1. The user configures days + time in Settings (synced via the preferences
 *      store as a {@link ReminderConfig}).
 *   2. `syncReminders(config)` reconciles the OS schedule: it always cancels the
 *      seven possible reminder slots first (so de-selecting a day removes its
 *      notification), then schedules the active set. Cancel-then-schedule keeps
 *      the deterministic IDs in `workoutReminders.ts` idempotent — re-syncing is
 *      always safe and never duplicates.
 *   3. Enabling reminders requests notification permission once; if the user
 *      declines, nothing is scheduled and the caller learns via the return.
 *
 * Everything is a no-op on web (scheduled local notifications don't fire there),
 * so callers can invoke `syncReminders` unconditionally.
 */
import {
  buildReminderNotifications,
  hasActiveReminders,
  reminderNotificationIds,
  type ReminderConfig,
} from '../lib/workoutReminders'
import {
  cancelNotifications,
  ensureNotificationPermission,
  notificationsSupported,
  scheduleNotifications,
} from '../lib/localNotifications'

export type ReminderSyncResult =
  /** Reminders were (re)scheduled for the active days. */
  | 'scheduled'
  /** Config is inactive (disabled/no days) — any existing reminders were cleared. */
  | 'cleared'
  /** Notification permission was denied, so nothing could be scheduled. */
  | 'permission-denied'
  /** Platform can't schedule local notifications (web) — no-op. */
  | 'unsupported'

export interface UseWorkoutRemindersReturn {
  /** Whether scheduled local notifications are available on this platform. */
  isSupported: () => boolean
  /** Reconcile the OS notification schedule with the given config. */
  syncReminders: (config: ReminderConfig) => Promise<ReminderSyncResult>
}

export function useWorkoutReminders(): UseWorkoutRemindersReturn {
  async function syncReminders(config: ReminderConfig): Promise<ReminderSyncResult> {
    if (!notificationsSupported()) return 'unsupported'

    // Always clear the full slot range first so de-selecting a day (or disabling
    // entirely) removes its previously-scheduled notification.
    await cancelNotifications(reminderNotificationIds())

    if (!hasActiveReminders(config)) return 'cleared'

    const granted = await ensureNotificationPermission()
    if (!granted) return 'permission-denied'

    await scheduleNotifications(buildReminderNotifications(config))
    return 'scheduled'
  }

  return {
    isSupported: notificationsSupported,
    syncReminders,
  }
}
