/**
 * Native local-notifications bridge.
 *
 * Thin wrapper around `@capacitor/local-notifications` for scheduling the
 * recurring workout reminders whose payloads are computed (purely) in
 * `src/lib/workoutReminders.ts`. Scheduled local notifications only fire
 * reliably inside the native Capacitor shell — the web implementation only
 * delivers while the page is open, which is useless as a "come back and train"
 * cue — so every function here is a no-op on web.
 *
 * The plugin is loaded via a runtime-constructed dynamic import so the web
 * bundle never statically pulls in the native-only plugin (mirrors
 * `src/lib/appReview.ts`). The *what to schedule* decision lives in
 * `workoutReminders.ts` and is fully tested independent of this bridge.
 */
import { isNative } from './platform'
import { logWarn } from './logger'
import type { ReminderNotification } from './workoutReminders'

// Constructed at runtime so the bundler does not resolve/inline the native-only
// plugin during the web build.
const LOCAL_NOTIFICATIONS_PLUGIN = ['@capacitor', 'local-notifications'].join('/')

interface PermissionStatus {
  display: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
}

interface LocalNotificationsPlugin {
  checkPermissions: () => Promise<PermissionStatus>
  requestPermissions: () => Promise<PermissionStatus>
  schedule: (options: { notifications: ReminderNotification[] }) => Promise<unknown>
  cancel: (options: { notifications: { id: number }[] }) => Promise<void>
}

async function loadPlugin(): Promise<LocalNotificationsPlugin | null> {
  if (!isNative) return null
  try {
    const mod = (await import(/* @vite-ignore */ LOCAL_NOTIFICATIONS_PLUGIN)) as {
      LocalNotifications?: LocalNotificationsPlugin
    }
    return mod.LocalNotifications ?? null
  } catch (e) {
    logWarn('LocalNotifications plugin unavailable', { error: String(e) })
    return null
  }
}

/** Whether scheduled local notifications can fire on this platform (native only). */
export function notificationsSupported(): boolean {
  return isNative
}

/**
 * Ensure notification permission, requesting it once if still in the prompt
 * state. Returns true only when permission is granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const plugin = await loadPlugin()
  if (!plugin) return false
  try {
    const current = await plugin.checkPermissions()
    if (current.display === 'granted') return true
    if (current.display === 'denied') return false
    const requested = await plugin.requestPermissions()
    return requested.display === 'granted'
  } catch (e) {
    logWarn('LocalNotifications permission check failed', { error: String(e) })
    return false
  }
}

/** Cancel the given notification IDs. Safe to call with IDs that aren't scheduled. */
export async function cancelNotifications(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  const plugin = await loadPlugin()
  if (!plugin) return
  try {
    await plugin.cancel({ notifications: ids.map((id) => ({ id })) })
  } catch (e) {
    logWarn('LocalNotifications cancel failed', { error: String(e) })
  }
}

/** Schedule the given notifications. No-op on an empty list or on web. */
export async function scheduleNotifications(notifications: ReminderNotification[]): Promise<boolean> {
  if (notifications.length === 0) return true
  const plugin = await loadPlugin()
  if (!plugin) return false
  try {
    await plugin.schedule({ notifications })
    return true
  } catch (e) {
    logWarn('LocalNotifications schedule failed', { error: String(e) })
    return false
  }
}
