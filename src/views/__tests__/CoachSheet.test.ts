import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CoachSheet from '../CoachSheet.vue'
import { useCoach } from '../../composables/useCoach'
import type { CoachReview } from '../../lib/aiCoach'

// CoachSheet is a view that touches stores + supabase; mock those boundaries so
// the test exercises the component's STATE RENDERING in isolation. useCoach is
// the REAL singleton — the four states are driven through its exported refs.
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({ exercises: [], getOverloadSuggestion: () => null }),
}))
vi.mock('../../stores/bodyweight', () => ({ useBodyweightStore: () => ({ entries: [] }) }))
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({ weeklyTarget: 3, streakWeeks: 0 }),
}))
vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({ weightUnit: { value: 'lb' }, displayWeight: (w: number) => w }),
}))
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: vi.fn(), tabSwitch: vi.fn(), flushEngagement: vi.fn() }),
}))
vi.mock('../../lib/supabase', () => ({ isPreviewMode: { value: false }, supabase: null }))

const REVIEW: CoachReview = {
  headline: 'Strong, consistent week',
  sections: [
    { type: 'progress', title: 'Bench is climbing', body: 'Top set up 10 lb.', metric: { label: 'e1RM', value: '263 lb' } },
    { type: 'consistency', title: 'Four sessions', body: 'Hit your weekly target.' },
  ],
  focusNext: 'Push squat volume next week.',
}

let wrapper: VueWrapper | null = null

function mountSheet(props: { mode?: 'byo' | 'server' } = { mode: 'server' }) {
  wrapper = mount(CoachSheet, { attachTo: document.body, props })
  return wrapper
}

beforeEach(() => {
  const coach = useCoach()
  coach.reset()
  coach.remaining.value = null
  coach.resetsAt.value = null
  coach.errorKind.value = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('CoachSheet — states', () => {
  it('opens in the idle/pick state with a generate button', () => {
    mountSheet()
    const html = document.body.textContent ?? ''
    expect(html).toContain('Generate review')
    expect(html).toContain('Weekly Review')
  })

  it('shows the quota meter in the header from the cached remaining count', async () => {
    const coach = useCoach()
    coach.remaining.value = 2
    mountSheet()
    await nextTick()
    expect(document.body.textContent).toContain('2 reviews left this week')
  })

  it('renders a loading status and skeleton while generating', async () => {
    const coach = useCoach()
    mountSheet()
    coach.state.value = 'loading'
    await nextTick()
    expect(document.body.textContent).toContain('writing your review')
    expect(document.body.querySelector('.skeletonCard')).not.toBeNull()
  })

  it('renders the review headline, sections, and focus in the result state', async () => {
    const coach = useCoach()
    mountSheet()
    coach.review.value = REVIEW
    coach.state.value = 'result'
    await nextTick()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Strong, consistent week')
    expect(text).toContain('Bench is climbing')
    expect(text).toContain('263 lb')
    expect(text).toContain('Push squat volume next week.')
    // Section type labels render.
    expect(text).toContain('Progress')
    expect(text).toContain('Consistency')
  })

  it('renders model prose as TEXT, never as raw HTML (no v-html injection)', async () => {
    const coach = useCoach()
    mountSheet()
    coach.review.value = {
      headline: '<img src=x onerror=alert(1)>',
      sections: [],
      focusNext: '',
    }
    coach.state.value = 'result'
    await nextTick()
    // The angle-bracket string is rendered as literal text, not an <img> element.
    expect(document.body.querySelector('.coachHeadline img')).toBeNull()
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('shows a quota-exceeded message with the reset countdown', async () => {
    const coach = useCoach()
    mountSheet()
    coach.errorKind.value = 'quota_exceeded'
    coach.resetsAt.value = new Date(Date.now() + 3 * 86_400_000).toISOString()
    coach.state.value = 'error'
    await nextTick()
    const text = document.body.textContent ?? ''
    expect(text).toContain('out of reviews this week')
    expect(text).toMatch(/Resets in \d+ days/)
  })

  it('offers a retry only for retryable failures', async () => {
    const coach = useCoach()
    mountSheet()
    coach.errorKind.value = 'network'
    coach.errorRetryable.value = true
    coach.state.value = 'error'
    await nextTick()
    expect(document.body.textContent).toContain('Try again')
  })

  it('does not offer retry for a non-retryable failure', async () => {
    const coach = useCoach()
    mountSheet()
    coach.errorKind.value = 'consent_required'
    coach.errorRetryable.value = false
    coach.state.value = 'error'
    await nextTick()
    expect(document.body.textContent).not.toContain('Try again')
    expect(document.body.textContent).toContain('privacy terms')
  })

  it('emits close when the close button is pressed', async () => {
    const w = mountSheet()
    // The dialog is teleported to <body>, so query the document, not the wrapper tree.
    const closeBtn = document.body.querySelector<HTMLButtonElement>('.coachClose')
    expect(closeBtn).not.toBeNull()
    closeBtn!.click()
    await nextTick()
    expect(w.emitted('close')).toBeTruthy()
  })
})

describe('CoachSheet — bring-your-own-AI export (open loop)', () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  const clickNames: string[] = []

  beforeEach(() => {
    writeText.mockClear()
    clickNames.length = 0
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickNames.push(this.download)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the export panel instead of the server state machine', () => {
    mountSheet({ mode: 'byo' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Bring your own AI')
    expect(text).toContain('Copy to clipboard')
    expect(text).toContain('Download file')
    expect(text).toContain('Nothing leaves Lift until you paste it')
    // Server affordances are absent.
    expect(text).not.toContain('Generate review')
    expect(document.body.querySelector('.coachExportActions')).not.toBeNull()
  })

  it('copies the recommended prompt + training data to the clipboard', async () => {
    mountSheet({ mode: 'byo' })
    const copyBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.coachPrimaryBtn')].find(
      (b) => /Copy to clipboard/.test(b.textContent ?? ''),
    )
    expect(copyBtn).not.toBeNull()
    copyBtn!.click()
    await flushPromises()
    await nextTick()
    expect(writeText).toHaveBeenCalledTimes(1)
    const payloadText = writeText.mock.calls[0][0] as string
    // Carries the coaching instructions AND the delimited data block.
    expect(payloadText).toContain('strength-training coach')
    expect(payloadText).toContain('<data>')
    // Open loop: the prompt asks for prose, not the server's JSON schema.
    expect(payloadText).toContain('no JSON')
    expect(document.body.textContent).toContain('Copied to clipboard')
  })

  it('downloads the export as a dated markdown file', async () => {
    mountSheet({ mode: 'byo' })
    const dlBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.coachSecondaryBtn')].find(
      (b) => /Download file/.test(b.textContent ?? ''),
    )
    expect(dlBtn).not.toBeNull()
    dlBtn!.click()
    await nextTick()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickNames[0]).toMatch(/^lift-weekly-review-\d{4}-\d{2}-\d{2}\.md$/)
  })

  it('exposes a bodyweight opt-out that starts included and toggles off', async () => {
    mountSheet({ mode: 'byo' })
    const toggle = document.body.querySelector<HTMLButtonElement>('.coachToggleRow .glassToggle')
    expect(toggle).not.toBeNull()
    expect(toggle!.getAttribute('aria-checked')).toBe('true')
    toggle!.click()
    await nextTick()
    expect(toggle!.getAttribute('aria-checked')).toBe('false')
  })
})
