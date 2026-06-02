/**
 * Native bridge for changing the iOS app icon (`setAlternateIconName`).
 *
 * Uses Capacitor's `registerPlugin` so the web build has zero static dependency
 * on a native-only plugin — the proxy is only ever invoked inside a real native
 * shell. On web (and in tests) every call is a no-op. The matching iOS plugin
 * and asset-catalog entries are wired up in the Capacitor iOS build (#531/#216).
 */
import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { logError } from './logger'

interface AppIconPlugin {
  /** Set the active alternate icon. `name: null` restores the primary icon. */
  setIcon(options: { name: string | null }): Promise<void>
  /** Get the currently active alternate icon name (`null` = primary). */
  getIcon(): Promise<{ name: string | null }>
}

const AppIconNative = registerPlugin<AppIconPlugin>('AppIcon')

/** Apply an alternate app icon. No-ops on web; swallows native failures. */
export async function setNativeAppIcon(nativeName: string | null): Promise<void> {
  if (!isNative) return
  try {
    await AppIconNative.setIcon({ name: nativeName })
  } catch (e) {
    logError(e, { source: 'nativeAppIcon.setNativeAppIcon', nativeName })
  }
}

/** Read the active alternate app icon name. Returns `null` on web or failure. */
export async function getNativeAppIcon(): Promise<string | null> {
  if (!isNative) return null
  try {
    const { name } = await AppIconNative.getIcon()
    return name
  } catch (e) {
    logError(e, { source: 'nativeAppIcon.getNativeAppIcon' })
    return null
  }
}
