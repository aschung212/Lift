import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useNotification } from '../useNotification'

describe('useNotification', () => {
  let mockNotification: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    mockNotification = vi.fn()

    // Set up Notification API mock
    Object.defineProperty(window, 'Notification', {
      value: Object.assign(mockNotification, {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      }),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all expected methods', () => {
    const api = useNotification()
    expect(typeof api.isSupported).toBe('function')
    expect(typeof api.isPermissionGranted).toBe('function')
    expect(typeof api.hasBeenAsked).toBe('function')
    expect(typeof api.requestPermission).toBe('function')
    expect(typeof api.notify).toBe('function')
    expect(typeof api.notifyRestTimerComplete).toBe('function')
  })

  it('isSupported returns true when Notification API exists', () => {
    const { isSupported } = useNotification()
    expect(isSupported()).toBe(true)
  })

  it('isPermissionGranted returns false when permission is default', () => {
    const { isPermissionGranted } = useNotification()
    expect(isPermissionGranted()).toBe(false)
  })

  it('isPermissionGranted returns true when permission is granted', () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    const { isPermissionGranted } = useNotification()
    expect(isPermissionGranted()).toBe(true)
  })

  it('hasBeenAsked reads from localStorage', () => {
    const { hasBeenAsked } = useNotification()
    expect(hasBeenAsked()).toBe(false)
    localStorage.setItem('notification-permission-asked', 'true')
    expect(hasBeenAsked()).toBe(true)
  })

  it('requestPermission resolves true when granted', async () => {
    const { requestPermission } = useNotification()
    const result = await requestPermission()
    expect(result).toBe(true)
    expect(localStorage.getItem('notification-permission-asked')).toBe('true')
  })

  it('requestPermission resolves false when denied', async () => {
    ;(window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied')
    const { requestPermission } = useNotification()
    const result = await requestPermission()
    expect(result).toBe(false)
  })

  it('requestPermission returns true immediately if already granted', async () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    const { requestPermission } = useNotification()
    const result = await requestPermission()
    expect(result).toBe(true)
    expect(window.Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('requestPermission returns false immediately if already denied', async () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'denied',
      configurable: true,
    })
    const { requestPermission } = useNotification()
    const result = await requestPermission()
    expect(result).toBe(false)
    expect(window.Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('notify does nothing when app is visible', () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    const { notify } = useNotification()
    notify('Test', { body: 'test body' })
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('notify sends notification when app is hidden and permission granted', () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    // Remove service worker to test fallback path
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })
    const { notify } = useNotification()
    notify('Test Title', { body: 'test body' })
    expect(mockNotification).toHaveBeenCalledWith('Test Title', expect.objectContaining({
      body: 'test body',
      icon: '/icon-192.png',
      tag: 'rest-timer',
    }))
  })

  it('notify does not throw when permission not granted', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    const { notify } = useNotification()
    expect(() => notify('Test')).not.toThrow()
    expect(mockNotification).not.toHaveBeenCalled()
  })

  it('notifyRestTimerComplete sends rest-complete notification', () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })
    const { notifyRestTimerComplete } = useNotification()
    notifyRestTimerComplete()
    expect(mockNotification).toHaveBeenCalledWith('Rest Complete', expect.objectContaining({
      body: 'Time to start your next set!',
      tag: 'rest-timer',
      renotify: true,
    }))
  })

  it('notify tries service worker notification first', () => {
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      configurable: true,
    })
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    const showNotification = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ showNotification }),
      },
      configurable: true,
    })
    const { notify } = useNotification()
    notify('SW Test')
    // Service worker path is async — notification constructor should NOT be called synchronously
    expect(mockNotification).not.toHaveBeenCalled()
  })
})

describe('useNotification without Notification API', () => {
  let originalNotification: typeof window.Notification

  beforeEach(() => {
    originalNotification = window.Notification
    // Actually remove the property so 'Notification' in window === false
    delete (window as Record<string, unknown>).Notification
  })

  afterEach(() => {
    Object.defineProperty(window, 'Notification', {
      value: originalNotification,
      writable: true,
      configurable: true,
    })
  })

  it('isSupported returns false', () => {
    const { isSupported } = useNotification()
    expect(isSupported()).toBe(false)
  })

  it('requestPermission returns false', async () => {
    const { requestPermission } = useNotification()
    const result = await requestPermission()
    expect(result).toBe(false)
  })
})
