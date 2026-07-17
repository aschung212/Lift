import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { flushPromises, mount, VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import SharePickerSheet from '../SharePickerSheet.vue'
import type { SessionSummary } from '../../../lib/sessionSummary'

// ── Mocks ──────────────────────────────────────────────────────────────

const mockLogEvent = vi.fn()
vi.mock('../../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: mockLogEvent,
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  }),
}))

const mockShareCard = vi.fn().mockResolvedValue({ kind: 'shared' })
const mockDownloadCard = vi.fn().mockResolvedValue({ kind: 'downloaded', filename: 'lift.png' })
vi.mock('../../../composables/useWorkoutShare', () => ({
  useWorkoutShare: () => ({
    shareCard: mockShareCard,
    downloadCard: mockDownloadCard,
    isSharing: ref(false),
    lastError: ref(null),
  }),
}))

vi.mock('../../../composables/useTheme', () => ({
  useTheme: () => ({
    currentTheme: ref('eternal'),
    resolvedMode: ref('dark'),
  }),
}))

vi.mock('../../../composables/useModal', () => ({
  useModal: () => ({ open: vi.fn(), close: vi.fn() }),
}))

vi.mock('../../../composables/useSupporter', () => ({
  useSupporter: () => ({ isSupporter: ref(false) }),
}))

// ── Helpers ────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-05-20',
    date: 'Wed, May 20',
    duration: '1h 5m',
    totalVolume: 12000,
    setsCompleted: 15,
    exercises: 5,
    prs: 0,
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

describe('SharePickerSheet share-funnel analytics (#712)', () => {
  let wrapper: VueWrapper

  beforeEach(async () => {
    vi.clearAllMocks()
    wrapper = mount(SharePickerSheet, { props: { summary: makeSummary() } })
    // Cards are code-split behind dynamic imports (#937); let the thumbnails'
    // async components settle so their imports don't resolve after teardown.
    await flushPromises()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('logs share_opened when the sheet mounts', () => {
    expect(mockLogEvent).toHaveBeenCalledWith('share_opened', { format: 'square' })
  })

  it('logs share_card_selected when switching format to story', async () => {
    const storyBtn = wrapper.findAll('.spFormatBtn').find((b) => b.text() === 'Story')!
    await storyBtn.trigger('click')

    expect(mockLogEvent).toHaveBeenCalledWith(
      'share_card_selected',
      expect.objectContaining({ format: 'story' }),
    )
  })

  it('does not re-log share_card_selected when tapping the already-active format', async () => {
    const postBtn = wrapper.findAll('.spFormatBtn').find((b) => b.text() === 'Post')!
    await postBtn.trigger('click')

    expect(mockLogEvent).not.toHaveBeenCalledWith('share_card_selected', expect.anything())
  })

  it('logs share_card_selected when picking a different thumbnail', async () => {
    const thumbs = wrapper.findAll('.spThumb')
    expect(thumbs.length).toBeGreaterThan(1)
    await thumbs[1].trigger('click')

    expect(mockLogEvent).toHaveBeenCalledWith(
      'share_card_selected',
      expect.objectContaining({ format: 'square' }),
    )
  })
})
