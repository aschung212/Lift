import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useNotification, useBackgroundTracker } from '../useNotification'

describe('useNotification', () => {
  let originalNotification: typeof globalThis.Notification

  beforeEach(() => {
    originalNotification = globalThis.Notification
    localStorage.clear()
  })

  afterEach(() => {
    globalThis.Notification = originalNotification
    vi.restoreAllMocks()
  })

  describe('isSupported', () => {
    it('returns true when Notification is available', () => {
      // @ts-expect-error test mock
      globalThis.Notification = class {} as unknown as typeof Notification
      const { isSupported } = useNotification()
      expect(isSupported()).toBe(true)
    })

    it('returns false when Notification is not available', () => {
      // @ts-expect-error test mock
      delete globalThis.Notification
      const { isSupported } = useNotification()
      expect(isSupported()).toBe(false)
    })
  })

  describe('hasPermission', () => {
    it('returns true when permission is granted', () => {
      Object.defineProperty(globalThis, 'Notification', {
        value: { permission: 'granted' },
        writable: true,
        configurable: true,
      })
      const { hasPermission } = useNotification()
      expect(hasPermission()).toBe(true)
    })

    it('returns false when permission is denied', () => {
      Object.defineProperty(globalThis, 'Notification', {
        value: { permission: 'denied' },
        writable: true,
        configurable: true,
      })
      const { hasPermission } = useNotification()
      expect(hasPermission()).toBe(false)
    })
  })

  describe('requestPermission', () => {
    it('resolves to true when permission is granted', async () => {
      Object.defineProperty(globalThis, 'Notification', {
        value: {
          permission: 'default',
          requestPermission: vi.fn().mockResolvedValue('granted'),
        },
        writable: true,
        configurable: true,
      })
      const { requestPermission } = useNotification()
      const result = await requestPermission()
      expect(result).toBe(true)
    })

    it('returns false without prompting when already denied', async () => {
      const mockRequest = vi.fn()
      Object.defineProperty(globalThis, 'Notification', {
        value: {
          permission: 'denied',
          requestPermission: mockRequest,
        },
        writable: true,
        configurable: true,
      })
      const { requestPermission } = useNotification()
      const result = await requestPermission()
      expect(result).toBe(false)
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('returns true without prompting when already granted', async () => {
      const mockRequest = vi.fn()
      Object.defineProperty(globalThis, 'Notification', {
        value: {
          permission: 'granted',
          requestPermission: mockRequest,
        },
        writable: true,
        configurable: true,
      })
      const { requestPermission } = useNotification()
      const result = await requestPermission()
      expect(result).toBe(true)
      expect(mockRequest).not.toHaveBeenCalled()
    })
  })

  describe('notify', () => {
    it('does not show notification when app is visible and was not backgrounded', async () => {
      const mockClose = vi.fn()
      const MockNotification = vi.fn().mockImplementation(() => ({ close: mockClose, onclick: null }))
      Object.defineProperty(MockNotification, 'permission', { value: 'granted', configurable: true })
      // @ts-expect-error test mock
      globalThis.Notification = MockNotification

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      // Mock no service worker
      Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })

      const { notify } = useNotification()
      const result = await notify('Test')
      expect(result).toBe(false)
      expect(MockNotification).not.toHaveBeenCalled()
    })

    it('shows notification when app is hidden and permission granted', async () => {
      const mockShowNotification = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { getRegistration: vi.fn().mockResolvedValue({ showNotification: mockShowNotification }) },
        configurable: true,
      })

      Object.defineProperty(globalThis, 'Notification', {
        value: { permission: 'granted' },
        writable: true,
        configurable: true,
      })

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      const { notify } = useNotification()
      const result = await notify('Rest Complete', { body: 'Time to lift' })
      expect(result).toBe(true)
      expect(mockShowNotification).toHaveBeenCalledWith('Rest Complete', expect.objectContaining({
        body: 'Time to lift',
        tag: 'lift-rest-timer',
      }))
    })

    it('shows notification when wasBackgrounded is true even if currently visible', async () => {
      const mockShowNotification = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { getRegistration: vi.fn().mockResolvedValue({ showNotification: mockShowNotification }) },
        configurable: true,
      })

      Object.defineProperty(globalThis, 'Notification', {
        value: { permission: 'granted' },
        writable: true,
        configurable: true,
      })

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

      const { notify } = useNotification()
      const result = await notify('Rest Complete', { body: 'Back at it', wasBackgrounded: true })
      expect(result).toBe(true)
      expect(mockShowNotification).toHaveBeenCalledWith('Rest Complete', expect.objectContaining({
        body: 'Back at it',
        tag: 'lift-rest-timer',
      }))
    })

    it('falls back to Notification constructor when SW is unavailable', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { getRegistration: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })

      const mockClose = vi.fn()
      class MockNotification {
        static permission = 'granted'
        close = mockClose
        onclick = null
        constructor(public title: string, public options?: NotificationOptions) {}
      }
      // @ts-expect-error test mock
      globalThis.Notification = MockNotification

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      const { notify } = useNotification()
      const result = await notify('Rest Complete', { body: 'Time to lift' })
      expect(result).toBe(true)
    })

    it('does not show notification when permission is not granted', async () => {
      Object.defineProperty(globalThis, 'Notification', {
        value: { permission: 'default' },
        writable: true,
        configurable: true,
      })

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      const { notify } = useNotification()
      const result = await notify('Test')
      expect(result).toBe(false)
    })

    it('returns true even if Notification constructor throws', async () => {
      // SW available but throws, constructor also throws
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { getRegistration: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })

      Object.defineProperty(globalThis, 'Notification', {
        value: class {
          static permission = 'granted'
          constructor() { throw new TypeError('Illegal constructor') }
        },
        writable: true,
        configurable: true,
      })

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      const { notify } = useNotification()
      // Should not throw, just return false
      const result = await notify('Test')
      expect(result).toBe(false)
    })
  })

  describe('hasAskedBefore', () => {
    it('returns false initially', () => {
      const { hasAskedBefore } = useNotification()
      expect(hasAskedBefore()).toBe(false)
    })

    it('returns true after permission is requested', async () => {
      Object.defineProperty(globalThis, 'Notification', {
        value: {
          permission: 'default',
          requestPermission: vi.fn().mockResolvedValue('denied'),
        },
        writable: true,
        configurable: true,
      })
      const { requestPermission, hasAskedBefore } = useNotification()
      await requestPermission()
      expect(hasAskedBefore()).toBe(true)
    })
  })
})

describe('useBackgroundTracker', () => {
  it('starts with wasBackgrounded false', () => {
    const { wasBackgrounded } = useBackgroundTracker()
    expect(wasBackgrounded.value).toBe(false)
  })

  it('sets wasBackgrounded to true when visibility changes to hidden', () => {
    const { wasBackgrounded, startTracking, stopTracking } = useBackgroundTracker()
    startTracking()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(wasBackgrounded.value).toBe(true)
    stopTracking()
  })

  it('resets wasBackgrounded when startTracking is called again', () => {
    const { wasBackgrounded, startTracking, stopTracking } = useBackgroundTracker()
    startTracking()

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(wasBackgrounded.value).toBe(true)

    // Reset by calling startTracking again
    startTracking()
    expect(wasBackgrounded.value).toBe(false)
    stopTracking()
  })
})
