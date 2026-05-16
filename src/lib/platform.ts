import { Capacitor } from '@capacitor/core'

/** Whether the app is running inside a native Capacitor shell (iOS/Android). */
export const isNative = Capacitor.isNativePlatform()

/** The current platform: 'ios', 'android', or 'web'. */
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'

/** Whether the app is running on iOS (native or Safari PWA). */
export const isIOS =
  platform === 'ios' ||
  (typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && typeof window !== 'undefined' && !('MSStream' in window))
