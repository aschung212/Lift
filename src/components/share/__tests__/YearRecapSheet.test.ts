/**
 * YearRecapSheet — the Year in Review share surface (#1018).
 *
 * The sheet is the only consumer of the recap bucket, and it is what proves the
 * pipeline really is payload-agnostic: it hands `shareCard` a `{ recap }` prop
 * bag and a non-date `filenameKey`, both of which the pipeline hard-coded to a
 * `SessionSummary` before this feature. A drift back to `{ summary }` would
 * rasterize a blank PNG with nothing failing, so the prop bag is asserted
 * rather than assumed.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { flushPromises, mount, VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import YearRecapSheet from '../YearRecapSheet.vue'
import { RECAP_CARDS, loadCardComponent } from '../cardRegistry'
import type { YearRecap } from '../../../lib/yearRecap'

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
const mockDownloadCard = vi.fn().mockResolvedValue({ kind: 'downloaded', filename: 'lift-year-2026.png' })
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

const mockModalOpen = vi.fn()
const mockModalClose = vi.fn()
vi.mock('../../../composables/useModal', () => ({
  useModal: () => ({ open: mockModalOpen, close: mockModalClose }),
}))

const isSupporter = ref(false)
vi.mock('../../../composables/useSupporter', () => ({
  useSupporter: () => ({ isSupporter }),
}))

// ── Helpers ────────────────────────────────────────────────────────────

function makeRecap(overrides: Partial<YearRecap> = {}): YearRecap {
  return {
    year: 2026,
    totalVolume: 1_250_400,
    workouts: 148,
    sets: 2140,
    exercises: 22,
    prs: 31,
    bestLift: {
      exerciseId: 'ex1',
      name: 'Deadlift',
      loadLabel: '405 lbs',
      reps: 3,
      e1RM: 446,
      dateKey: '2026-08-14',
    },
    topTag: { tag: 'Push', sets: 620 },
    longestStreakWeeks: 19,
    monthlyVolume: [90_000, 102_000, 118_000, 96_000, 130_000, 108_000, 99_000, 141_000, 88_000, 92_000, 84_000, 2_400],
    busiestMonth: 7,
    unitLabel: 'lbs',
    ...overrides,
  }
}

async function mountSheet(recap = makeRecap()) {
  const wrapper = mount(YearRecapSheet, {
    props: { recap },
    global: { stubs: { Teleport: true } },
  })
  // The card components are code-split behind dynamic imports (#937).
  await flushPromises()
  return wrapper
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('YearRecapSheet (#1018)', () => {
  let wrapper: VueWrapper

  beforeAll(async () => {
    // Warm the code-split card chunks (#937) so the sheet's own
    // `await loadCardComponent(...)` settles inside a single flushPromises —
    // resolving them through the REAL registry, which is also the assertion
    // that both recap ids are registered and loadable.
    for (const { id } of RECAP_CARDS) expect(await loadCardComponent(id)).toBeTruthy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    isSupporter.value = false
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('titles itself with the recap year and summarizes the year under it', async () => {
    wrapper = await mountSheet()
    expect(wrapper.find('#yrSheetTitle').text()).toBe('2026 in Review')
    expect(wrapper.find('.yrsheetSub').text()).toBe('148 workouts · 2140 sets')
  })

  it('singularizes a one-workout year rather than reading "1 workouts"', async () => {
    wrapper = await mountSheet(makeRecap({ workouts: 1, sets: 1 }))
    expect(wrapper.find('.yrsheetSub').text()).toBe('1 workout · 1 set')
  })

  it('opens on the square Post card and takes the scroll lock + focus trap', async () => {
    wrapper = await mountSheet()
    const toggles = wrapper.findAll('.yrsheetFormatBtn')
    expect(toggles.map((b) => b.text())).toEqual(['Post', 'Story'])
    expect(toggles[0].attributes('aria-pressed')).toBe('true')
    expect(mockModalOpen).toHaveBeenCalled()
    expect(mockLogEvent).toHaveBeenCalledWith('share_opened', { format: 'square', card: 'year-recap' })
  })

  it('shares the square card with the recap as its props and a year filename', async () => {
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()

    expect(mockShareCard).toHaveBeenCalledTimes(1)
    const req = mockShareCard.mock.calls[0][0]
    expect(req.format).toBe('square')
    // `{ recap }`, not `{ summary }` — the whole point of the payload-agnostic
    // pipeline. A card mounted with the wrong prop rasterizes blank.
    expect(req.props).toEqual({ recap: makeRecap() })
    expect(req.filenameKey).toBe('year-2026')
    expect(req.theme).toBe('eternal')
    expect(req.mode).toBe('dark')
    expect(req.watermark).toBe(true)
  })

  it('switches to the story card and shares that format instead', async () => {
    wrapper = await mountSheet()
    await wrapper.findAll('.yrsheetFormatBtn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.yrsheetFormatBtn')[1].attributes('aria-pressed')).toBe('true')
    expect(mockLogEvent).toHaveBeenCalledWith('share_card_selected', { format: 'story', card: 'year-recap-story' })

    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()
    expect(mockShareCard.mock.calls[0][0].format).toBe('story')
  })

  it('closes itself once the card has actually been shared', async () => {
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('reports the saved filename instead of closing when the share falls back to a download', async () => {
    mockShareCard.mockResolvedValueOnce({ kind: 'downloaded', filename: 'lift-year-2026.png' })
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.yrsheetStatus').text()).toBe('Saved lift-year-2026.png')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('surfaces a failed share rather than closing on it', async () => {
    mockShareCard.mockResolvedValueOnce({ kind: 'error' })
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.yrsheetStatus').text()).toBe('Share failed — try again')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('saves the image directly, bypassing the share sheet', async () => {
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetActionSecondary').trigger('click')
    await flushPromises()

    expect(mockDownloadCard).toHaveBeenCalledTimes(1)
    expect(mockDownloadCard.mock.calls[0][0].filenameKey).toBe('year-2026')
    expect(mockShareCard).not.toHaveBeenCalled()
    expect(wrapper.find('.yrsheetStatus').text()).toBe('Saved lift-year-2026.png')
  })

  it('drops the free-tier watermark for a supporter (#601)', async () => {
    isSupporter.value = true
    wrapper = await mountSheet()
    expect(wrapper.find('.yrsheetWatermark').exists()).toBe(false)

    await wrapper.find('.yrsheetActionPrimary').trigger('click')
    await flushPromises()
    expect(mockShareCard.mock.calls[0][0].watermark).toBe(false)
  })

  it('offers a close control and an overlay tap that both dismiss', async () => {
    wrapper = await mountSheet()
    await wrapper.find('.yrsheetClose').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('.yrsheetOverlay').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
