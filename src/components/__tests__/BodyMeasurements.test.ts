import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock, mockAnalytics, mockWeightUnit } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../composables/useAnalytics', () => mockAnalytics())
vi.mock('../../composables/useWeightUnit', () => mockWeightUnit())

import BodyMeasurements from '../../views/BodyMeasurements.vue'
import { useBodyMeasurementsStore } from '../../stores/bodyMeasurements'

function mountCard(): VueWrapper {
  return mount(BodyMeasurements, {
    global: { stubs: { Teleport: true } },
  })
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

describe('BodyMeasurements', () => {
  let store: ReturnType<typeof useBodyMeasurementsStore>

  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = useBodyMeasurementsStore()
    store.entries = []
  })

  describe('type selector', () => {
    it('renders a tab for each tracked body part', () => {
      const wrapper = mountCard()
      const tabs = wrapper.findAll('.bmTypeBtn')
      expect(tabs).toHaveLength(4)
      expect(tabs.map(t => t.text())).toEqual(['Chest', 'Arms', 'Waist', 'Thighs'])
    })

    it('defaults to Chest selected', () => {
      const wrapper = mountCard()
      const active = wrapper.find('.bmTypeBtn.active')
      expect(active.text()).toBe('Chest')
      expect(active.attributes('aria-selected')).toBe('true')
    })

    it('switches the active type on click', async () => {
      const wrapper = mountCard()
      await wrapper.findAll('.bmTypeBtn')[2].trigger('click') // Waist
      const active = wrapper.find('.bmTypeBtn.active')
      expect(active.text()).toBe('Waist')
    })
  })

  describe('empty state', () => {
    it('shows a type-specific prompt when no entries', () => {
      const wrapper = mountCard()
      const empty = wrapper.find('.bwEmptyState')
      expect(empty.exists()).toBe(true)
      expect(empty.text().toLowerCase()).toContain('chest')
      expect(wrapper.text()).toContain('No entries')
    })
  })

  describe('latest value + unit conversion', () => {
    it('shows the latest value converted to inches for imperial users', () => {
      // 101.6 cm == 40 in
      store.addEntry('chest', 101.6, daysAgo(1))
      const wrapper = mountCard()
      expect(wrapper.find('.bwCurrentValue').text()).toBe('40 in')
    })

    it('shows a delta vs the previous entry', () => {
      store.addEntry('chest', 99.06, daysAgo(2)) // 39 in
      store.addEntry('chest', 101.6, daysAgo(1)) // 40 in
      const wrapper = mountCard()
      expect(wrapper.find('.bwGoalProgressHint').text()).toContain('+1 in since previous')
    })
  })

  describe('entry list', () => {
    it('lists only entries of the selected type, newest first', async () => {
      store.addEntry('chest', 101.6, daysAgo(3))
      store.addEntry('chest', 104.14, daysAgo(1)) // 41 in
      store.addEntry('arms', 38.1, daysAgo(1))
      const wrapper = mountCard()
      const rows = wrapper.findAll('.wtSetRow')
      expect(rows).toHaveLength(2)
      expect(rows[0].find('.wtSetDetail').text()).toBe('41 in')
    })

    it('reveals edit/delete actions on row tap', async () => {
      store.addEntry('chest', 101.6, daysAgo(1))
      const wrapper = mountCard()
      await wrapper.find('.wtSetRow').trigger('click')
      expect(wrapper.find('.wtSetActions').exists()).toBe(true)
    })
  })

  describe('chart', () => {
    it('renders an SVG line chart with >= 2 entries', () => {
      store.addEntry('chest', 100, daysAgo(5))
      store.addEntry('chest', 101, daysAgo(1))
      const wrapper = mountCard()
      const svg = wrapper.find('svg.wtGraphSvg')
      expect(svg.exists()).toBe(true)
      expect(svg.attributes('role')).toBe('img')
      expect(svg.find('polyline.wtGLine').exists()).toBe(true)
    })

    it('does not render the chart with a single entry', () => {
      store.addEntry('chest', 100, daysAgo(1))
      const wrapper = mountCard()
      expect(wrapper.find('svg.wtGraphSvg').exists()).toBe(false)
      expect(wrapper.find('.bwStatsSingle').exists()).toBe(true)
    })
  })

  describe('logging via modal', () => {
    it('saves a new measurement in canonical cm', async () => {
      const addSpy = vi.spyOn(store, 'addEntry')
      const wrapper = mountCard()
      await wrapper.find('.wtLogBtn').trigger('click')
      const input = wrapper.find('.repMaxInput')
      await input.setValue('40') // 40 in
      await wrapper.find('.repMaxBtnCalc').trigger('click')
      expect(addSpy).toHaveBeenCalledWith('chest', 101.6, expect.any(String))
    })
  })
})
