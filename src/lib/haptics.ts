/**
 * Haptic feedback utilities.
 * Triggers native haptics on iOS/Android via Capacitor, no-ops on web.
 */
import { isNative } from './platform'

type ImpactStyle = 'Heavy' | 'Medium' | 'Light'

async function impact(style: ImpactStyle = 'Light'): Promise<void> {
  if (!isNative) return
  const { Haptics, ImpactStyle: Styles } = await import('@capacitor/haptics')
  await Haptics.impact({ style: Styles[style] })
}

/** Light tap — for set logging, toggle presses */
export const tapLight = (): Promise<void> => impact('Light')

/** Medium tap — for PR detection, important actions */
export const tapMedium = (): Promise<void> => impact('Medium')

/** Heavy tap — for destructive actions, warnings */
export const tapHeavy = (): Promise<void> => impact('Heavy')

/** Success notification pattern */
export async function notifySuccess(): Promise<void> {
  if (!isNative) return
  const { Haptics, NotificationType } = await import('@capacitor/haptics')
  await Haptics.notification({ type: NotificationType.Success })
}

/** Warning notification pattern */
export async function notifyWarning(): Promise<void> {
  if (!isNative) return
  const { Haptics, NotificationType } = await import('@capacitor/haptics')
  await Haptics.notification({ type: NotificationType.Warning })
}
