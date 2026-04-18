/**
 * Haptic feedback composable.
 *
 * Prefers Capacitor Haptics (available when wrapped as a native app),
 * falls back to the Web Vibration API (Android browsers), and silently
 * no-ops when neither is available (desktop, iOS Safari).
 *
 * Respects the user's `experience.haptics` preference: when the toggle is
 * off (Settings → Experience → Haptics), impact/notification calls no-op.
 */

import { usePreferencesStore } from '../stores/preferences'

type ImpactStyle = 'light' | 'medium' | 'heavy'

interface CapacitorHaptics {
  impact(options: { style: string }): Promise<void>
  notification(options: { type: string }): Promise<void>
}

let capacitorHaptics: CapacitorHaptics | null = null
let capacitorChecked = false

function hapticsAllowed(): boolean {
  // Defensive: Pinia may not be active (e.g. some test setups).
  try {
    const prefs = usePreferencesStore()
    return prefs.experience?.haptics !== false
  } catch {
    return true
  }
}

async function getCapacitorHaptics(): Promise<CapacitorHaptics | null> {
  if (capacitorChecked) return capacitorHaptics
  capacitorChecked = true
  try {
    // Only use Capacitor Haptics when running as a native app.
    // The web shim throws "not implemented on web" for haptic methods.
    const core = await import('@capacitor/core')
    if (!core.Capacitor.isNativePlatform()) return null
    const mod = await import('@capacitor/haptics')
    capacitorHaptics = mod.Haptics as unknown as CapacitorHaptics
    return capacitorHaptics
  } catch {
    return null
  }
}

function vibrate(ms: number | number[]): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(ms)
  }
}

async function impact(style: ImpactStyle = 'light'): Promise<void> {
  if (!hapticsAllowed()) return
  const haptics = await getCapacitorHaptics()
  if (haptics) {
    const styleMap: Record<ImpactStyle, string> = {
      light: 'Light',
      medium: 'Medium',
      heavy: 'Heavy',
    }
    await haptics.impact({ style: styleMap[style] })
    return
  }
  // Web Vibration API fallback
  const durationMap: Record<ImpactStyle, number> = { light: 10, medium: 25, heavy: 40 }
  vibrate(durationMap[style])
}

async function notification(type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {
  if (!hapticsAllowed()) return
  const haptics = await getCapacitorHaptics()
  if (haptics) {
    const typeMap: Record<string, string> = {
      success: 'Success',
      warning: 'Warning',
      error: 'Error',
    }
    await haptics.notification({ type: typeMap[type] })
    return
  }
  // Web Vibration API fallback — pattern varies by type
  const patternMap: Record<string, number | number[]> = {
    success: [15, 50, 15],
    warning: [30, 50, 30],
    error: [50, 30, 50, 30, 50],
  }
  vibrate(patternMap[type])
}

export function useHaptics() {
  return {
    /** Light tap — use for routine actions like logging a set */
    impactLight: () => impact('light'),
    /** Medium tap — use for notable events like a new PR */
    impactMedium: () => impact('medium'),
    /** Heavy tap — use for significant milestones */
    impactHeavy: () => impact('heavy'),
    /** Success notification pattern — use for PR celebrations */
    notifySuccess: () => notification('success'),
    /** Warning notification pattern */
    notifyWarning: () => notification('warning'),
    /** Error notification pattern */
    notifyError: () => notification('error'),
  }
}
