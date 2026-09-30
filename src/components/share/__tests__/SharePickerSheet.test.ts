import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { flushPromises, mount, VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import SharePickerSheet from '../SharePickerSheet.vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
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
const mockDownloadCard = vi.fn().mockResolvedValue({ kind: 'downloaded', filename: 'logbook.png' })
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
    progress: null,
    unitLabel: 'lbs',
    ...overrides,
  }
}

function makeRecap(overrides: Partial<YearRecap> = {}): YearRecap {
  return {
    year: 2026,
    workouts: 148,
    sets: 1820,
    reps: 14960,
    totalVolume: 1284500,
    exercises: 22,
    prs: 31,
    longestStreakWeeks: 19,
    topLift: { exerciseId: 'ex1', name: 'Deadlift', load: '405 lbs', reps: 3, e1RM: 446 },
    mostTrained: { kind: 'tag', name: 'Push', sets: 540 },
    unitLabel: 'lbs',
    ...overrides,
  }
}

describe('SharePickerSheet share-funnel analytics (#712)', () => {
  let wrapper: VueWrapper

  beforeEach(async () => {
    vi.clearAllMocks()
    wrapper = mount(SharePickerSheet, {
      props: { subject: { kind: 'session', summary: makeSummary() } },
    })
    // Cards are code-split behind dynamic imports (#937); let the thumbnails'
    // async components settle so their imports don't resolve after teardown.
    await flushPromises()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('logs share_opened when the sheet mounts', () => {
    expect(mockLogEvent).toHaveBeenCalledWith('share_opened', { format: 'square', subject: 'session' })
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

  it('keeps the picked card when the host re-renders with an equivalent subject', async () => {
    // A host binding an inline `:subject="{ … }"` literal hands the sheet a
    // fresh object on every one of its own re-renders, which would rebuild
    // `cards` and — under a watch keyed on the array identity — silently reset
    // the user's pick back to the first thumbnail. The watch is keyed on the
    // card ids for exactly this.
    const total = wrapper.findAll('.spThumb').length
    expect(total).toBeGreaterThan(2)
    await wrapper.findAll('.spThumb')[2].trigger('click')
    expect(wrapper.get('.spCount').text()).toBe(`3 / ${total}`)

    await wrapper.setProps({ subject: { kind: 'session', summary: makeSummary() } })
    await flushPromises()

    expect(wrapper.get('.spCount').text()).toBe(`3 / ${total}`)
  })
})

// ── Year-recap subject (#1018) ────────────────────────────────────────────
//
// The sheet is the one place where the subject decides BOTH which cards are
// offered and which prop each is mounted with. Getting the two out of step
// mounts a card with a prop it never declared, which rasterizes to a blank PNG
// — a failure that only shows up after the user has already shared it.

describe('SharePickerSheet with a year recap', () => {
  let wrapper: VueWrapper

  beforeEach(async () => {
    vi.clearAllMocks()
    wrapper = mount(SharePickerSheet, {
      props: { subject: { kind: 'recap', recap: makeRecap() } },
    })
    await flushPromises()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('offers only the recap cards, never a session card', async () => {
    const labels = wrapper.findAll('.spThumbLabel').map((n) => n.text())
    expect(labels).toEqual(['Year'])

    const storyBtn = wrapper.findAll('.spFormatBtn').find((b) => b.text() === 'Story')!
    await storyBtn.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.spThumbLabel').map((n) => n.text())).toEqual(['Year'])
  })

  it('renders the recap inside the thumbnail, so the preview is the export', async () => {
    // Thumbnails are `defineAsyncComponent` wrappers over a dynamic import
    // (#937), and that import is a real on-demand SFC transform — it takes
    // wall-clock time, not a microtask, so `flushPromises` cannot see it.
    // The volume only appears if the card actually received its `recap` prop.
    await vi.waitFor(() => expect(wrapper.text()).toContain('1,284,500'))
  })

  it('titles the sheet for the year rather than "Pick a card"', () => {
    expect(wrapper.get('#spTitle').text()).toBe('Year in review')
    expect(wrapper.get('.spSub').text()).toBe('Your 2026 in numbers')
  })

  it('labels the funnel events as a recap share', () => {
    expect(mockLogEvent).toHaveBeenCalledWith('share_opened', { format: 'square', subject: 'recap' })
  })

  it('hands the share flow the recap subject, not a summary', async () => {
    await wrapper.get('.spActionPrimary').trigger('click')
    // `onShare` awaits the card's dynamic import before calling the flow.
    await vi.waitFor(() => expect(mockShareCard).toHaveBeenCalled())

    expect(mockShareCard).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'square',
        subject: { kind: 'recap', recap: makeRecap() },
      }),
    )
  })

  it('ignores an initialCardId that names a session card', async () => {
    // The PR-focus entry point (#716) is a session concept. A recap host that
    // passed one through must not land the sheet on a card the recap bucket
    // does not contain — `activeCard` would be undefined and Share inert.
    const w = mount(SharePickerSheet, {
      props: { subject: { kind: 'recap', recap: makeRecap() }, initialCardId: 'pr-focus' },
    })
    await flushPromises()
    expect(w.get('.spCount').text()).toBe('1 / 1')
    expect(w.findAll('.spFormatBtn').find((b) => b.text() === 'Post')!.classes())
      .toContain('spFormatBtnActive')
    w.unmount()
  })
})
