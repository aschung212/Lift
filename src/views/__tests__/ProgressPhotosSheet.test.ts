import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProgressPhotosSheet from '../ProgressPhotosSheet.vue'
import type { ProgressPhotoMeta } from '../../lib/progressPhotos'

// Stub the modal + analytics edges; drive the timeline through the store mock.
vi.mock('../../composables/useModal', () => ({
  useModal: () => ({ open: vi.fn(), close: vi.fn() }),
}))
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: vi.fn() }),
}))

const state = vi.hoisted(() => ({ photos: [] as ProgressPhotoMeta[] }))

vi.mock('../../stores/progressPhotos', () => ({
  useProgressPhotosStore: () => ({
    get photos() { return state.photos },
    get sortedPhotos() { return state.photos },
    get count() { return state.photos.length },
    hydrate: vi.fn().mockResolvedValue(undefined),
    // No blob so the sheet renders placeholders and never calls createObjectURL.
    blobFor: vi.fn().mockResolvedValue(null),
    setCaption: vi.fn(),
    removePhoto: vi.fn(),
  }),
}))

function meta(id: string, date: string): ProgressPhotoMeta {
  return { id, date, caption: '', createdAt: `${date}T00:00:00Z` }
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  state.photos = []
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('ProgressPhotosSheet', () => {
  it('shows the empty state and an add button, but no compare with <2 photos', async () => {
    wrapper = mount(ProgressPhotosSheet, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelector('.ppEmpty')).not.toBeNull()
    expect(document.body.querySelector('.ppAddBtn')).not.toBeNull()
    // Compare only earns its place once there are two shots to compare.
    const buttons = [...document.body.querySelectorAll('button')].map(b => b.textContent?.trim())
    expect(buttons.some(t => t === 'Compare')).toBe(false)
  })

  it('renders a thumbnail per photo and offers Compare with >=2', async () => {
    state.photos = [meta('a', '2026-08-01'), meta('b', '2026-08-10')]
    wrapper = mount(ProgressPhotosSheet, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelectorAll('.ppThumb')).toHaveLength(2)
    const compareBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      b => b.textContent?.trim() === 'Compare',
    )
    expect(compareBtn).toBeTruthy()
  })

  it('enters compare mode and shows a side-by-side pair after two selections', async () => {
    state.photos = [meta('a', '2026-08-01'), meta('b', '2026-08-11')]
    wrapper = mount(ProgressPhotosSheet, { attachTo: document.body })
    await nextTick()

    const compareBtn = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      b => b.textContent?.trim() === 'Compare',
    )!
    compareBtn.click()
    await nextTick()

    const thumbs = document.body.querySelectorAll<HTMLButtonElement>('.ppThumb')
    thumbs[0].click()
    thumbs[1].click()
    await nextTick()

    expect(document.body.querySelector('.ppCompare')).not.toBeNull()
    // 10 days between 2026-08-01 and 2026-08-11.
    expect(document.body.querySelector('.ppCompareSpan')?.textContent).toContain('10 days apart')
  })

  it('emits close when the close button is tapped', async () => {
    wrapper = mount(ProgressPhotosSheet, { attachTo: document.body })
    await nextTick()

    document.body.querySelector<HTMLButtonElement>('.ppClose')!.click()
    await nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
