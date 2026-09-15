/**
 * Native bridge for changing the iOS app icon (`setAlternateIconName`).
 *
 * Uses Capacitor's `registerPlugin` so the web build has zero static dependency
 * on a native-only plugin — the proxy is only ever invoked inside a real native
 * shell. On web (and in tests) every call is a no-op. The matching iOS plugin
 * and asset-catalog entries are wired up in the Capacitor iOS build (#531/#216).
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { logError } from './logger'

interface AppIconPlugin {
  /** Set the active alternate icon. `name: null` restores the primary icon. */
  setIcon(options: { name: string | null }): Promise<void>
  /** Get the currently active alternate icon name (`null` = primary). */
  getIcon(): Promise<{ name: string | null }>
}

const AppIconNative = registerPlugin<AppIconPlugin>('AppIcon')

/**
 * Whether the native `AppIcon` plugin is actually registered in this shell.
 *
 * The Swift half of this bridge does not exist yet (it lands with the
 * committed iOS project, #531), so until then every native launch called
 * `setIcon` into a plugin Capacitor had never heard of and logged
 * `"AppIcon" plugin is not implemented on ios` — and Settings rendered an
 * icon picker whose taps could do nothing (#1423). `isPluginAvailable` asks
 * the bridge for the registered plugin headers, so the picker appears the
 * moment the plugin is shipped and never before. Always false on web.
 */
export function isAppIconPluginAvailable(): boolean {
  return isNative && Capacitor.isPluginAvailable('AppIcon')
}

/** Apply an alternate app icon. No-ops on web and where the plugin is absent; swallows native failures. */
export async function setNativeAppIcon(nativeName: string | null): Promise<void> {
  if (!isAppIconPluginAvailable()) return
  try {
    await AppIconNative.setIcon({ name: nativeName })
  } catch (e) {
    logError(e, { source: 'nativeAppIcon.setNativeAppIcon', nativeName })
  }
}

/** Read the active alternate app icon name. Returns `null` on web, where the plugin is absent, or on failure. */
export async function getNativeAppIcon(): Promise<string | null> {
  if (!isAppIconPluginAvailable()) return null
  try {
    const { name } = await AppIconNative.getIcon()
    return name
  } catch (e) {
    logError(e, { source: 'nativeAppIcon.getNativeAppIcon' })
    return null
  }
}
