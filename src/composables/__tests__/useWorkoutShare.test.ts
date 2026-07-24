import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent } from 'vue'
import type { ShareCardRequest } from '../useWorkoutShare'
import type { SessionSummary } from '../../lib/sessionSummary'

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock modern-screenshot at the module level — renderNodeToBlob calls `domToBlob`
// internally. We mock the higher-level shareImage module so we don't need
// a real DOM rasterizer.
const mockRenderNodeToBlob = vi.fn<(node: HTMLElement, opts: unknown) => Promise<Blob>>()

vi.mock('../../lib/shareImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shareImage')>()
  return {
    ...actual,
    renderNodeToBlob: (...args: Parameters<typeof actual.renderNodeToBlob>) =>
      mockRenderNodeToBlob(...args),
  }
})

// Capture analytics so the share-funnel events (#712) can be asserted.
const mockLogEvent = vi.fn()
vi.mock('../useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: mockLogEvent,
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  }),
}))

// ── Helpers ────────────────────────────────────────────────────────────

const DummyCard = defineComponent({ name: 'DummyCard', template: '<div>card</div>' })

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-05-20',
    date: 'Wed, May 20',
    duration: '1h 5m',
    totalVolume: 12000,
    setsCompleted: 15,
    exercises: 5,
    prs: 1,
    repPRs: 0,
    bestSet: null,
    highlights: [],
    weekVolume: [0, 0, 12000, 0, 0, 0, 0],
    priorWeekVolume: 10000,
    streak: 3,
    unitLabel: 'lbs',
    ...overrides,
  }
}

function makeRequest(overrides: Partial<ShareCardRequest> = {}): ShareCardRequest {
  return {
    component: DummyCard,
    format: 'square',
    summary: makeSummary(),
    theme: 'eternal',
    mode: 'dark',
    ...overrides,
  }
}

const fakeBlob = new Blob(['fake-png'], { type: 'image/png' })

// ── Tests ──────────────────────────────────────────────────────────────

describe('useWorkoutShare', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockLogEvent.mockClear()
    mockRenderNodeToBlob.mockResolvedValue(fakeBlob)

    createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url')
    revokeObjectURLSpy = vi.fn()
    globalThis.URL.createObjectURL = createObjectURLSpy
    globalThis.URL.revokeObjectURL = revokeObjectURLSpy

    // Default: no Web Share API
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: undefined, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    mockRenderNodeToBlob.mockClear()
  })

  // Fresh import each test to avoid shared state between `isSharing`/`lastError`
  async function getComposable() {
    // Dynamic import to get a fresh module scope each time isn't needed —
    // useWorkoutShare returns new refs on each call (factory pattern).
    const { useWorkoutShare } = await import('../useWorkoutShare')
    return useWorkoutShare()
  }

  // ── Reactive state ─────────────────────────────────────────────────

  describe('initial state', () => {
    it('isSharing starts as false', async () => {
      const { isSharing } = await getComposable()
      expect(isSharing.value).toBe(false)
    })

    it('lastError starts as null', async () => {
      const { lastError } = await getComposable()
      expect(lastError.value).toBeNull()
    })
  })

  // ── shareCard ──────────────────────────────────────────────────────

  describe('shareCard', () => {
    it('falls back to download when Web Share API is unavailable', async () => {
      const { shareCard, isSharing } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'downloaded', filename: 'lift-2026-05-20.png' })
      expect(isSharing.value).toBe(false)
    })

    it('generates story filename for story format', async () => {
      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest({ format: 'story' }))

      expect(result).toEqual({ kind: 'downloaded', filename: 'lift-2026-05-20-story.png' })
    })

    it('uses Web Share API when available and supported', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      const canShareFn = vi.fn().mockReturnValue(true)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'shared' })
      expect(shareFn).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([expect.any(File)]),
          title: 'Lift workout',
        }),
      )
    })

    it('includes the canonical app link in the Web Share payload (#794)', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      const canShareFn = vi.fn().mockReturnValue(true)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      expect(shareFn).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([expect.any(File)]),
          title: 'Lift workout',
          url: 'https://spa-rho-sandy.vercel.app',
          text: expect.stringContaining('Lift'),
        }),
      )
    })

    it('pre-fills a suggested caption + branded hashtag in the payload text (#1020)', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      const canShareFn = vi.fn().mockReturnValue(true)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      // makeSummary() has prs: 1, so the PR-led caption is expected.
      await shareCard(makeRequest())

      const payload = shareFn.mock.calls[0][0] as ShareData
      expect(payload.text).toContain('#LiftedWithLift')
      expect(payload.text).toContain('New PR')
    })

    it('carries the caption on the image-only fallback payload too (#1020)', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      // Reject any url-carrying payload, accept files-only.
      const canShareFn = vi.fn((data: ShareData) => !('url' in data))
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      const payload = shareFn.mock.calls[0][0] as ShareData
      expect('url' in payload).toBe(false)
      expect(payload.text).toContain('#LiftedWithLift')
    })

    it('degrades to an image-only payload when the link-carrying payload is rejected (#794)', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      // canShare rejects any payload carrying a url, accepts files-only.
      const canShareFn = vi.fn((data: ShareData) => !('url' in data))
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'shared' })
      const payload = shareFn.mock.calls[0][0] as ShareData
      expect(payload.files).toBeDefined()
      expect('url' in payload).toBe(false)
    })

    it('returns cancelled when user dismisses share sheet (AbortError)', async () => {
      const abortError = new DOMException('User cancelled', 'AbortError')
      const shareFn = vi.fn().mockRejectedValue(abortError)
      const canShareFn = vi.fn().mockReturnValue(true)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'cancelled' })
    })

    it('falls back to download when Web Share throws non-AbortError', async () => {
      const shareFn = vi.fn().mockRejectedValue(new Error('NetworkError'))
      const canShareFn = vi.fn().mockReturnValue(true)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: canShareFn, writable: true, configurable: true })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'downloaded', filename: 'lift-2026-05-20.png' })
    })

    it('returns cancelled when already sharing (reentrance guard)', async () => {
      const { shareCard, isSharing } = await getComposable()

      // Start a share that won't resolve immediately
      let resolveRender!: (blob: Blob) => void
      mockRenderNodeToBlob.mockReturnValueOnce(
        new Promise<Blob>((resolve) => {
          resolveRender = resolve
        }),
      )

      const first = shareCard(makeRequest())

      // isSharing should be true now
      expect(isSharing.value).toBe(true)

      // Second call while first is in-flight
      const second = await shareCard(makeRequest())
      expect(second).toEqual({ kind: 'cancelled' })

      // Let first complete
      resolveRender(fakeBlob)
      await first
      expect(isSharing.value).toBe(false)
    })

    it('returns error result when rendering fails', async () => {
      const renderError = new Error('Render failed')
      mockRenderNodeToBlob.mockRejectedValueOnce(renderError)

      const { shareCard, lastError } = await getComposable()
      const result = await shareCard(makeRequest())

      expect(result).toEqual({ kind: 'error', error: renderError })
      expect(lastError.value).toBe(renderError)
    })

    it('resets lastError on new attempt', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('first fail'))

      const { shareCard, lastError } = await getComposable()

      await shareCard(makeRequest())
      expect(lastError.value).not.toBeNull()

      // Successful second attempt — mock already reset to default resolved value
      mockRenderNodeToBlob.mockResolvedValueOnce(fakeBlob)
      await shareCard(makeRequest())
      expect(lastError.value).toBeNull()
    })

    it('resets isSharing even when an error occurs', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('boom'))

      const { shareCard, isSharing } = await getComposable()
      await shareCard(makeRequest())

      expect(isSharing.value).toBe(false)
    })

    it('passes theme and mode to the offscreen container', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ theme: 'fire', mode: 'light' }))

      // renderNodeToBlob receives the host node. Verify it was called.
      expect(mockRenderNodeToBlob).toHaveBeenCalledTimes(1)
      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      expect(hostNode.getAttribute('data-theme')).toBe('fire')
      expect(hostNode.getAttribute('data-mode')).toBe('light')
    })

    it('cleans up the host element from the DOM after rendering', async () => {
      const { shareCard } = await getComposable()
      const bodyChildrenBefore = document.body.children.length
      await shareCard(makeRequest())
      expect(document.body.children.length).toBe(bodyChildrenBefore)
    })

    it('cleans up the host element from the DOM even on error', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('render fail'))

      const { shareCard } = await getComposable()
      const bodyChildrenBefore = document.body.children.length
      await shareCard(makeRequest())
      expect(document.body.children.length).toBe(bodyChildrenBefore)
    })
  })

  // ── downloadCard ───────────────────────────────────────────────────

  describe('downloadCard', () => {
    it('downloads the card directly without trying Web Share', async () => {
      const shareFn = vi.fn()
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), writable: true, configurable: true })

      const { downloadCard } = await getComposable()
      const result = await downloadCard(makeRequest())

      expect(result).toEqual({ kind: 'downloaded', filename: 'lift-2026-05-20.png' })
      expect(shareFn).not.toHaveBeenCalled()
    })

    it('creates and clicks a temporary anchor element', async () => {
      const clickSpy = vi.fn()
      const origCreateElement = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tag, options)
        if (tag === 'a') {
          vi.spyOn(el, 'click').mockImplementation(clickSpy)
        }
        return el
      })

      const { downloadCard } = await getComposable()
      await downloadCard(makeRequest())

      expect(clickSpy).toHaveBeenCalledOnce()
      expect(createObjectURLSpy).toHaveBeenCalled()
    })

    it('revokes the object URL after a delay', async () => {
      const { downloadCard } = await getComposable()
      await downloadCard(makeRequest())

      expect(revokeObjectURLSpy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
    })

    it('returns cancelled when already sharing', async () => {
      const { downloadCard } = await getComposable()

      let resolveRender!: (blob: Blob) => void
      mockRenderNodeToBlob.mockReturnValueOnce(
        new Promise<Blob>((resolve) => {
          resolveRender = resolve
        }),
      )

      const first = downloadCard(makeRequest())
      const second = await downloadCard(makeRequest())

      expect(second).toEqual({ kind: 'cancelled' })

      resolveRender(fakeBlob)
      await first
    })

    it('returns error result when rendering fails', async () => {
      const err = new Error('download render fail')
      mockRenderNodeToBlob.mockRejectedValueOnce(err)

      const { downloadCard, lastError } = await getComposable()
      const result = await downloadCard(makeRequest())

      expect(result).toEqual({ kind: 'error', error: err })
      expect(lastError.value).toBe(err)
    })
  })

  // ── canWebShareFiles (tested indirectly) ───────────────────────────

  describe('Web Share API detection', () => {
    it('skips Web Share when navigator.share is undefined', async () => {
      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())
      expect(result.kind).toBe('downloaded')
    })

    it('skips Web Share when canShare returns false', async () => {
      Object.defineProperty(navigator, 'share', { value: vi.fn(), writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(false), writable: true, configurable: true })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())
      expect(result.kind).toBe('downloaded')
    })

    it('skips Web Share when canShare throws', async () => {
      Object.defineProperty(navigator, 'share', { value: vi.fn(), writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', {
        value: vi.fn().mockImplementation(() => { throw new TypeError('not allowed') }),
        writable: true,
        configurable: true,
      })

      const { shareCard } = await getComposable()
      const result = await shareCard(makeRequest())
      expect(result.kind).toBe('downloaded')
    })
  })

  // ── Offscreen rendering pipeline ───────────────────────────────────

  describe('offscreen rendering', () => {
    it('passes correct dimensions for square format', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ format: 'square' }))

      const opts = mockRenderNodeToBlob.mock.calls[0][1] as { width: number; height: number }
      expect(opts.width).toBe(360)
      expect(opts.height).toBe(360)
    })

    it('passes correct dimensions for story format', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ format: 'story' }))

      const opts = mockRenderNodeToBlob.mock.calls[0][1] as { width: number; height: number }
      expect(opts.width).toBe(360)
      expect(opts.height).toBe(640)
    })

    it('positions host offscreen for rendering', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      expect(hostNode.style.left).toBe('-10000px')
      expect(hostNode.style.position).toBe('absolute')
    })
  })

  // ── Watermark (#601) ───────────────────────────────────────────────

  describe('watermark', () => {
    it('injects the "Made with Lift" watermark when watermark is true', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ watermark: true }))

      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      const mark = hostNode.querySelector('[data-share-watermark]')
      expect(mark).not.toBeNull()
      expect(mark?.textContent).toBe('Made with Lift')
    })

    it('omits the watermark when watermark is false', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ watermark: false }))

      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      expect(hostNode.querySelector('[data-share-watermark]')).toBeNull()
    })

    it('omits the watermark by default (no opt-in)', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      expect(hostNode.querySelector('[data-share-watermark]')).toBeNull()
    })

    it('injects the watermark on the download path too', async () => {
      const { downloadCard } = await getComposable()
      await downloadCard(makeRequest({ watermark: true }))

      const hostNode = mockRenderNodeToBlob.mock.calls[0][0]
      expect(hostNode.querySelector('[data-share-watermark]')).not.toBeNull()
    })
  })

  // ── Share-funnel analytics (#712) ──────────────────────────────────
  describe('share-funnel analytics', () => {
    it('logs share_completed with outcome "shared" when Web Share succeeds', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), writable: true, configurable: true })

      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ format: 'story' }))

      expect(mockLogEvent).toHaveBeenCalledWith('share_completed', {
        format: 'story',
        method: 'share',
        outcome: 'shared',
      })
    })

    it('logs share_completed with outcome "downloaded" when sharing falls back to download', async () => {
      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      expect(mockLogEvent).toHaveBeenCalledWith('share_completed', {
        format: 'square',
        method: 'share',
        outcome: 'downloaded',
      })
    })

    it('does NOT log a completed/failed event when the user cancels the share sheet', async () => {
      const abortError = new DOMException('User cancelled', 'AbortError')
      Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(abortError), writable: true, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), writable: true, configurable: true })

      const { shareCard } = await getComposable()
      await shareCard(makeRequest())

      expect(mockLogEvent).not.toHaveBeenCalledWith('share_completed', expect.anything())
      expect(mockLogEvent).not.toHaveBeenCalledWith('share_failed', expect.anything())
    })

    it('logs share_failed with method "share" when rendering fails', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('boom'))

      const { shareCard } = await getComposable()
      await shareCard(makeRequest({ format: 'story' }))

      expect(mockLogEvent).toHaveBeenCalledWith('share_failed', { format: 'story', method: 'share' })
    })

    it('logs share_completed with method "save" on the download path', async () => {
      const { downloadCard } = await getComposable()
      await downloadCard(makeRequest())

      expect(mockLogEvent).toHaveBeenCalledWith('share_completed', {
        format: 'square',
        method: 'save',
        outcome: 'downloaded',
      })
    })

    it('logs share_failed with method "save" when download rendering fails', async () => {
      mockRenderNodeToBlob.mockRejectedValueOnce(new Error('download fail'))

      const { downloadCard } = await getComposable()
      await downloadCard(makeRequest())

      expect(mockLogEvent).toHaveBeenCalledWith('share_failed', { format: 'square', method: 'save' })
    })
  })
})
