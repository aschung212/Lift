import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppIcon from '../AppIcon.vue'
import { icons, type IconName } from '../../lib/icons'

const iconNames = Object.keys(icons) as IconName[]

describe('AppIcon', () => {
  it('renders the canonical 24×24 stroke wrapper', () => {
    const wrapper = mount(AppIcon, { props: { name: 'plus' } })
    const svg = wrapper.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.element.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.attributes('fill')).toBe('none')
    expect(svg.attributes('stroke')).toBe('currentColor')
  })

  it('defaults to 24px and applies the size prop to width and height', () => {
    const dflt = mount(AppIcon, { props: { name: 'plus' } }).find('svg')
    expect(dflt.attributes('width')).toBe('24')
    expect(dflt.attributes('height')).toBe('24')

    const sized = mount(AppIcon, { props: { name: 'plus', size: 16 } }).find('svg')
    expect(sized.attributes('width')).toBe('16')
    expect(sized.attributes('height')).toBe('16')
  })

  it('uses the registry stroke width and allows a per-usage override', () => {
    const canonical = mount(AppIcon, { props: { name: 'flame' } }).find('svg')
    expect(canonical.attributes('stroke-width')).toBe('2.2')

    const overridden = mount(AppIcon, { props: { name: 'flame', strokeWidth: 3 } }).find('svg')
    expect(overridden.attributes('stroke-width')).toBe('3')
  })

  it('applies round line caps for rounded glyphs and omits them for square ones', () => {
    const rounded = mount(AppIcon, { props: { name: 'clock' } }).find('svg')
    expect(rounded.attributes('stroke-linecap')).toBe('round')
    expect(rounded.attributes('stroke-linejoin')).toBe('round')

    const square = mount(AppIcon, { props: { name: 'gear' } }).find('svg')
    expect(square.attributes('stroke-linecap')).toBeUndefined()
    expect(square.attributes('stroke-linejoin')).toBeUndefined()
  })

  it('renders the registered shapes as SVG children', () => {
    const wrapper = mount(AppIcon, { props: { name: 'search' } })
    expect(wrapper.find('circle').exists()).toBe(true)
    expect(wrapper.find('line').exists()).toBe(true)
  })

  it('passes class and aria attributes through to the root svg', () => {
    const wrapper = mount(AppIcon, {
      props: { name: 'search' },
      attrs: { class: 'wtSearchIcon', 'aria-hidden': 'true' },
    })
    const svg = wrapper.find('svg')
    expect(svg.classes()).toContain('wtSearchIcon')
    expect(svg.attributes('aria-hidden')).toBe('true')
  })

  it('every registry glyph renders at least one shape', () => {
    for (const name of iconNames) {
      const wrapper = mount(AppIcon, { props: { name } })
      expect(wrapper.find('svg').element.children.length).toBeGreaterThan(0)
    }
  })
})
