import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreferencesStore } from '../../stores/preferences'
import {
  notificationsAvailable,
  notificationPermission,
  showRestTimerNotification,
} from '../useNotifications'

// happy-dom does not provide Notification — we mock it per test.
function mockNotificationAPI(permission: string) {
  const ctor = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Notification = Object.assign(ctor, { permission }) as any
  return ctor
}

describe('useNotifications', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Clean slate — no Notification by default (matches happy-dom)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Notification
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Notification
    vi.restoreAllMocks()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
  })

  describe('notificationsAvailable', () => {
    it('returns true when Notification API exists', () => {
      mockNotificationAPI('default')
      expect(notificationsAvailable()).toBe(true)
    })

    it('returns false when Notification API is missing', () => {
      expect(notificationsAvailable()).toBe(false)
    })
  })

  describe('notificationPermission', () => {
    it('returns the current permission when API exists', () => {
      mockNotificationAPI('granted')
      expect(notificationPermission()).toBe('granted')
    })

    it('returns unavailable when API is missing', () => {
      expect(notificationPermission()).toBe('unavailable')
    })
  })

  describe('showRestTimerNotification', () => {
    it('does not fire when document is visible (foreground)', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      })
      const ctor = mockNotificationAPI('granted')
      showRestTimerNotification()
      expect(ctor).not.toHaveBeenCalled()
    })

    it('does not fire when preference is disabled', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      const prefs = usePreferencesStore()
      prefs.setExperienceFlag('restTimerNotifications', false)

      const ctor = mockNotificationAPI('granted')

      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: null },
        configurable: true,
      })

      showRestTimerNotification()
      expect(ctor).not.toHaveBeenCalled()
    })

    it('does not fire when permission is not granted', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      const prefs = usePreferencesStore()
      prefs.setExperienceFlag('restTimerNotifications', true)

      const ctor = mockNotificationAPI('default')

      showRestTimerNotification()
      expect(ctor).not.toHaveBeenCalled()
    })

    it('does not fire when Notification API is unavailable', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      // No Notification mock — API is absent
      showRestTimerNotification()
      // Should not throw
    })

    it('fires basic notification when backgrounded, enabled, and granted', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      const prefs = usePreferencesStore()
      prefs.setExperienceFlag('restTimerNotifications', true)

      const ctor = mockNotificationAPI('granted')

      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: null },
        configurable: true,
      })

      showRestTimerNotification()
      expect(ctor).toHaveBeenCalledWith('Rest Timer Done', expect.objectContaining({
        body: 'Time to start your next set!',
        tag: 'rest-timer',
      }))
    })

    it('uses service worker showNotification when controller is available', async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      })
      const prefs = usePreferencesStore()
      prefs.setExperienceFlag('restTimerNotifications', true)

      const ctor = mockNotificationAPI('granted')

      const showNotificationMock = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          controller: {},
          ready: Promise.resolve({ showNotification: showNotificationMock }),
        },
        configurable: true,
      })

      showRestTimerNotification()
      // Wait for the SW ready promise to resolve
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(showNotificationMock).toHaveBeenCalledWith('Rest Timer Done', expect.objectContaining({
        body: 'Time to start your next set!',
        tag: 'rest-timer',
        renotify: true,
      }))
      // Basic notification constructor should NOT have been called (SW path succeeded)
      expect(ctor).not.toHaveBeenCalled()
    })
  })
})
