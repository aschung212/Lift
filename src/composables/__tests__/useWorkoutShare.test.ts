import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------- Mocks ----------

// Mock shareImage — replaces the heavy html-to-image dependency
const mockRenderNodeToBlob = vi.fn<[], Promise<Blob>>()
vi.mock('../../lib/shareImage', () => ({
  renderNodeToBlob: (...args: unknown[]) => mockRenderNodeToBlob(...(args as [])),
  defaultShareFilename: (rawDate: string, format: string) => {
    const suffix = format === 'story' ? '-story' : ''
    return `lift-${rawDate}${suffix}.png`
  },
  PREVIEW_SIZE: {
    square: { width: 360, height: 360 },
    story: { width: 360, height: 640 },
  },
  EXPORT_PIXEL_RATIO: 3,
}))

import { useWorkoutShare, type ShareCardRequest } from '../useWorkoutShare'
import type { SessionSummary } from '../../lib/sessionSummary'

// ---------- Helpers ----------

function makeBlob(): Blob {
  return new Blob(['png-bytes'], { type: 'image/png' })
}

function makeSummary(): SessionSummary {
  return {
    rawDate: '2026-05-19',
    date: 'Mon, May 19',
    duration: '45m',
    totalVolume: 10000,
    setsCompleted: 15,
    exercises: 4,
    prs: 1,
    repPRs: 0,
    bestSet: null,
    highlights: [],
    weekVolume: [0, 5000, 3000, 2000, 0, 0, 0],
    priorWeekVolume: 8000,
    streak: 3,
    unitLabel: 'lbs',
  }
}

function makeRequest(overrides?: Partial<ShareCardRequest>): ShareCardRequest {
  return {
    component: { render: () => null },
    format: 'square',
    summary: makeSummary(),
    theme: 'eternal',
    mode: 'dark',
    ...overrides,
  }
}

// Stub getComputedStyle so snapshotThemeVars() resolves
let computedStyleMap: Record<string, string> = {}

function stubComputedStyle(vars: Record<string, string>): void {
  computedStyleMap = vars
}

// ---------- Setup / Teardown ----------

let originalGetComputedStyle: typeof window.getComputedStyle
let originalCreateObjectURL: typeof URL.createObjectURL
let originalRevokeObjectURL: typeof URL.revokeObjectURL
let createObjectURLSpy: ReturnType<typeof vi.fn>
let revokeObjectURLSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  mockRenderNodeToBlob.mockResolvedValue(makeBlob())

  // Stub URL.createObjectURL / revokeObjectURL (save originals for restore)
  originalCreateObjectURL = globalThis.URL.createObjectURL
  originalRevokeObjectURL = globalThis.URL.revokeObjectURL
  createObjectURLSpy = vi.fn().mockReturnValue('blob:http://localhost/fake-id')
  revokeObjectURLSpy = vi.fn()
  globalThis.URL.createObjectURL = createObjectURLSpy
  globalThis.URL.revokeObjectURL = revokeObjectURLSpy

  // Stub getComputedStyle to return theme vars
  originalGetComputedStyle = window.getComputedStyle
  window.getComputedStyle = vi.fn().mockReturnValue({
    getPropertyValue: (name: string) => computedStyleMap[name] ?? '',
  }) as unknown as typeof window.getComputedStyle

  stubComputedStyle({
    '--bg-primary': '#000',
    '--accent': 'gold',
    '--text-primary': '#fff',
  })
})

afterEach(() => {
  // Flush the 1000ms revokeObjectURL timer from downloadBlob before restoring mocks
  vi.runAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.getComputedStyle = originalGetComputedStyle
  globalThis.URL.createObjectURL = originalCreateObjectURL
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL
  computedStyleMap = {}
  // Clear navigator.share / canShare that individual tests may have set
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
})

// ---------- Tests ----------

describe('useWorkoutShare', () => {
  describe('shareCard', () => {
    it('downloads when Web Share API is unavailable', async () => {
      // navigator.share is undefined by default in jsdom
      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({
        kind: 'downloaded',
        filename: 'lift-2026-05-19.png',
      })
    })

    it('uses Web Share API when canShare reports file support', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
      Object.defineProperty(navigator, 'canShare', {
        value: () => true,
        configurable: true,
      })

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(shareFn).toHaveBeenCalledOnce()
      expect(result).toEqual({ kind: 'shared' })
      // Verify it passed a File with the correct name and type
      const passedFiles = shareFn.mock.calls[0][0].files as File[]
      expect(passedFiles).toHaveLength(1)
      expect(passedFiles[0].name).toBe('lift-2026-05-19.png')
      expect(passedFiles[0].type).toBe('image/png')
    })

    it('returns cancelled when user dismisses the share sheet (AbortError)', async () => {
      const abortError = new DOMException('Share cancelled', 'AbortError')
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockRejectedValue(abortError),
        configurable: true,
      })
      Object.defineProperty(navigator, 'canShare', {
        value: () => true,
        configurable: true,
      })

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'cancelled' })
    })

    it('falls back to download when share throws a non-AbortError', async () => {
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
        configurable: true,
      })
      Object.defineProperty(navigator, 'canShare', {
        value: () => true,
        configurable: true,
      })

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({
        kind: 'downloaded',
        filename: 'lift-2026-05-19.png',
      })
    })

    it('returns cancelled and guards against duplicate requests', async () => {
      const { shareCard } = useWorkoutShare()

      // First call sets isSharing synchronously, then yields at the first await
      const first = shareCard(makeRequest())

      // Second call runs synchronously before first completes — guard fires
      const second = await shareCard(makeRequest())
      expect(second).toEqual({ kind: 'cancelled' })

      // Let the first call finish to reset state
      await first
    })

    it('returns error and sets lastError when rendering fails', async () => {
      const renderError = new Error('Canvas tainted')
      mockRenderNodeToBlob.mockRejectedValueOnce(renderError)

      const { shareCard, lastError } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'error', error: renderError })
      expect(lastError.value).toBe(renderError)
    })

    it('resets isSharing to false after completion', async () => {
      const { shareCard, isSharing } = useWorkoutShare()
      expect(isSharing.value).toBe(false)

      const promise = shareCard(makeRequest())
      // isSharing may be true while the promise is pending — depends on microtask order
      await promise

      expect(isSharing.value).toBe(false)
    })

    it('resets isSharing to false even after an error', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('fail'))
      const { shareCard, isSharing } = useWorkoutShare()

      await shareCard(makeRequest())
      expect(isSharing.value).toBe(false)
    })

    it('generates story-format filenames', async () => {
      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest({ format: 'story' }))

      expect(result).toEqual({
        kind: 'downloaded',
        filename: 'lift-2026-05-19-story.png',
      })
    })

    it('clears lastError on a new successful share', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('first call fail'))
      const { shareCard, lastError } = useWorkoutShare()

      await shareCard(makeRequest())
      expect(lastError.value).toBeInstanceOf(Error)

      // Second call succeeds
      mockRenderNodeToBlob.mockResolvedValueOnce(makeBlob())
      await shareCard(makeRequest())
      expect(lastError.value).toBeNull()
    })
  })

  describe('downloadCard', () => {
    it('downloads directly without trying Web Share', async () => {
      const shareFn = vi.fn()
      Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
      Object.defineProperty(navigator, 'canShare', {
        value: () => true,
        configurable: true,
      })

      const { downloadCard } = useWorkoutShare()
      const result = await downloadCard(makeRequest())

      expect(shareFn).not.toHaveBeenCalled()
      expect(result).toEqual({
        kind: 'downloaded',
        filename: 'lift-2026-05-19.png',
      })
    })

    it('guards against duplicate requests', async () => {
      const { downloadCard } = useWorkoutShare()

      const first = downloadCard(makeRequest())
      const second = await downloadCard(makeRequest())
      expect(second).toEqual({ kind: 'cancelled' })

      await first
    })

    it('returns error when rendering fails', async () => {
      const renderError = new Error('render failed')
      mockRenderNodeToBlob.mockRejectedValueOnce(renderError)

      const { downloadCard, lastError } = useWorkoutShare()
      const result = await downloadCard(makeRequest())

      expect(result).toEqual({ kind: 'error', error: renderError })
      expect(lastError.value).toBe(renderError)
    })

    it('resets isSharing after download', async () => {
      const { downloadCard, isSharing } = useWorkoutShare()
      await downloadCard(makeRequest())
      expect(isSharing.value).toBe(false)
    })
  })

  describe('offscreen rendering', () => {
    it('mounts a temporary DOM node and cleans up after render', async () => {
      const bodyChildrenBefore = document.body.children.length

      const { shareCard } = useWorkoutShare()
      await shareCard(makeRequest())

      // The offscreen host should be removed after rendering
      expect(document.body.children.length).toBe(bodyChildrenBefore)
    })

    it('cleans up the DOM even when rendering throws', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('render kaboom'))
      const bodyChildrenBefore = document.body.children.length

      const { shareCard } = useWorkoutShare()
      await shareCard(makeRequest())

      expect(document.body.children.length).toBe(bodyChildrenBefore)
    })

    it('applies theme and mode attributes to the offscreen host', async () => {
      let capturedHost: HTMLElement | null = null
      mockRenderNodeToBlob.mockImplementationOnce(async (node: HTMLElement) => {
        capturedHost = node
        return makeBlob()
      })

      const { shareCard } = useWorkoutShare()
      await shareCard(makeRequest({ theme: 'fire', mode: 'light' }))

      expect(capturedHost).not.toBeNull()
      expect(capturedHost!.getAttribute('data-theme')).toBe('fire')
      expect(capturedHost!.getAttribute('data-mode')).toBe('light')
    })

    it('inlines resolved theme CSS variables onto the host', async () => {
      stubComputedStyle({
        '--bg-primary': '#1a1a1a',
        '--accent': '#ffd700',
      })

      let capturedHost: HTMLElement | null = null
      mockRenderNodeToBlob.mockImplementationOnce(async (node: HTMLElement) => {
        capturedHost = node
        return makeBlob()
      })

      const { shareCard } = useWorkoutShare()
      await shareCard(makeRequest())

      const style = capturedHost!.style.cssText
      expect(style).toContain('--bg-primary')
      expect(style).toContain('--accent')
    })
  })

  describe('canWebShareFiles (via shareCard behavior)', () => {
    it('skips Web Share when canShare is not defined', async () => {
      // navigator.share exists but canShare does not
      Object.defineProperty(navigator, 'share', {
        value: vi.fn(),
        configurable: true,
      })
      // canShare stays undefined

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      // Falls through to download since canShare is missing
      expect(result.kind).toBe('downloaded')
      expect(navigator.share).not.toHaveBeenCalled()
    })

    it('skips Web Share when canShare throws', async () => {
      Object.defineProperty(navigator, 'share', {
        value: vi.fn(),
        configurable: true,
      })
      Object.defineProperty(navigator, 'canShare', {
        value: () => { throw new TypeError('Unsupported') },
        configurable: true,
      })

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result.kind).toBe('downloaded')
    })

    it('skips Web Share when canShare returns false', async () => {
      Object.defineProperty(navigator, 'share', {
        value: vi.fn(),
        configurable: true,
      })
      Object.defineProperty(navigator, 'canShare', {
        value: () => false,
        configurable: true,
      })

      const { shareCard } = useWorkoutShare()
      const result = await shareCard(makeRequest())

      expect(result.kind).toBe('downloaded')
      expect(navigator.share).not.toHaveBeenCalled()
    })
  })
})
