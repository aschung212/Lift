import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useNotification } from '../useNotification'

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
    it('does not show notification when app is visible', () => {
      const mockClose = vi.fn()
      const MockNotification = vi.fn().mockImplementation(() => ({ close: mockClose, onclick: null }))
      Object.defineProperty(MockNotification, 'permission', { value: 'granted', configurable: true })
      // @ts-expect-error test mock
      globalThis.Notification = MockNotification

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

      const { notify } = useNotification()
      const result = notify('Test')
      expect(result).toBeNull()
      expect(MockNotification).not.toHaveBeenCalled()
    })

    it('shows notification when app is hidden and permission granted', () => {
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
      const result = notify('Rest Complete', { body: 'Time to lift' })
      expect(result).not.toBeNull()
      expect(result).toBeInstanceOf(MockNotification)
      expect((result as unknown as MockNotification).title).toBe('Rest Complete')
      expect((result as unknown as MockNotification).options).toMatchObject({
        body: 'Time to lift',
        tag: 'lift-rest-timer',
      })
    })

    it('does not show notification when permission is not granted', () => {
      const MockNotification = vi.fn()
      Object.defineProperty(MockNotification, 'permission', { value: 'default', configurable: true })
      // @ts-expect-error test mock
      globalThis.Notification = MockNotification

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

      const { notify } = useNotification()
      const result = notify('Test')
      expect(result).toBeNull()
      expect(MockNotification).not.toHaveBeenCalled()
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
