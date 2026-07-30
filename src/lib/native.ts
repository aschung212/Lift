/**
 * Native plugin initialization for Capacitor.
 * Only activates when running inside a native shell — no-ops on web.
 */
import { isNative, platform } from './platform'
import { initializePurchases } from '../composables/usePurchases'

export async function initNativePlugins(): Promise<void> {
  if (!isNative) return

  if (platform === 'ios') {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setOverlaysWebView({ overlay: true })
  }

  // Configure keyboard behavior for iOS
  const { Keyboard } = await import('@capacitor/keyboard')
  Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty(
      '--keyboard-height',
      `${info.keyboardHeight}px`
    )
  })
  Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px')
  })

  // In-app purchases / Supporter entitlement (LIFT-598) — done last so a slow
  // purchase-SDK configure never delays UI-critical status-bar/keyboard setup.
  // RevenueCat's iOS SDK key is a publishable client key (safe to embed); a
  // missing key leaves the free tier intact so an unprovisioned build never
  // breaks. See docs/iap.md.
  await initializePurchases(import.meta.env.VITE_REVENUECAT_IOS_KEY as string | undefined)
}
