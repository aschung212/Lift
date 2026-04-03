/**
 * Native plugin initialization for Capacitor.
 * Only activates when running inside a native shell — no-ops on web.
 */
import { isNative, platform } from './platform'

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
}
