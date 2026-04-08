import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkeletonLoader from '../SkeletonLoader.vue'

describe('SkeletonLoader', () => {
  it('renders the skeleton card structure', () => {
    const wrapper = mount(SkeletonLoader)
    expect(wrapper.find('.skeletonCard').exists()).toBe(true)
    expect(wrapper.find('.skeletonHeader').exists()).toBe(true)
    expect(wrapper.find('.skeletonTitle').exists()).toBe(true)
    expect(wrapper.find('.skeletonBtn').exists()).toBe(true)
    expect(wrapper.find('.skeletonBody').exists()).toBe(true)
  })

  it('renders no rows when rows prop is undefined', () => {
    const wrapper = mount(SkeletonLoader)
    expect(wrapper.findAll('.skeletonRow')).toHaveLength(0)
  })

  it('renders the correct number of rows', () => {
    const wrapper = mount(SkeletonLoader, { props: { rows: 4 } })
    expect(wrapper.findAll('.skeletonRow')).toHaveLength(4)
  })

  it('renders each row with left content and badge', () => {
    const wrapper = mount(SkeletonLoader, { props: { rows: 2 } })
    const rows = wrapper.findAll('.skeletonRow')
    for (const row of rows) {
      expect(row.find('.skeletonRowLeft').exists()).toBe(true)
      expect(row.find('.skeletonLabel').exists()).toBe(true)
      expect(row.find('.skeletonSubLabel').exists()).toBe(true)
      expect(row.find('.skeletonBadge').exists()).toBe(true)
    }
  })

  it('renders zero rows when rows is 0', () => {
    const wrapper = mount(SkeletonLoader, { props: { rows: 0 } })
    expect(wrapper.findAll('.skeletonRow')).toHaveLength(0)
  })

  it('renders one row when rows is 1', () => {
    const wrapper = mount(SkeletonLoader, { props: { rows: 1 } })
    expect(wrapper.findAll('.skeletonRow')).toHaveLength(1)
  })

  it('has role="status" for screen reader announcement', () => {
    const wrapper = mount(SkeletonLoader)
    const card = wrapper.find('.skeletonCard')
    expect(card.attributes('role')).toBe('status')
  })

  it('has aria-label describing the loading state', () => {
    const wrapper = mount(SkeletonLoader)
    const card = wrapper.find('.skeletonCard')
    expect(card.attributes('aria-label')).toBe('Loading content')
  })

  it('has aria-busy="true" to indicate loading', () => {
    const wrapper = mount(SkeletonLoader)
    const card = wrapper.find('.skeletonCard')
    expect(card.attributes('aria-busy')).toBe('true')
  })
})
