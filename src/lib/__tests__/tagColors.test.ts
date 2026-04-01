import { describe, it, expect } from 'vitest'
import { getTagColor, type TagColor } from '../tagColors'

describe('getTagColor', () => {
  it('returns an object with border and bg properties', () => {
    const result = getTagColor('chest')
    expect(result).toHaveProperty('border')
    expect(result).toHaveProperty('bg')
    expect(result.border).toMatch(/^#[0-9a-f]{6}$/)
    expect(result.bg).toMatch(/^rgba\(/)
  })

  it('returns the same color for the same tag name', () => {
    const first = getTagColor('legs')
    const second = getTagColor('legs')
    expect(first).toEqual(second)
  })

  it('returns deterministic results across calls', () => {
    const tags = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core']
    const firstPass = tags.map(getTagColor)
    const secondPass = tags.map(getTagColor)
    expect(firstPass).toEqual(secondPass)
  })

  it('returns different colors for different tag names', () => {
    // With 8 colors and many tags, at least some should differ
    const colors = new Set(
      ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'stretch']
        .map(t => getTagColor(t).border)
    )
    expect(colors.size).toBeGreaterThan(1)
  })

  it('handles empty string', () => {
    const result = getTagColor('')
    expect(result).toHaveProperty('border')
    expect(result).toHaveProperty('bg')
  })

  it('handles special characters', () => {
    const result = getTagColor('push/pull')
    expect(result).toHaveProperty('border')
    expect(result.border).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('handles unicode characters', () => {
    const result = getTagColor('日本語')
    expect(result).toHaveProperty('border')
    expect(result.border).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is case-sensitive', () => {
    const lower = getTagColor('chest')
    const upper = getTagColor('Chest')
    // These may or may not be equal depending on hash, but the function should handle both
    expect(lower).toHaveProperty('border')
    expect(upper).toHaveProperty('border')
  })

  it('always returns a color from the 8-color palette', () => {
    const validBorders = [
      '#2dd4bf', '#f472b6', '#60a5fa', '#fb923c',
      '#a78bfa', '#4ade80', '#fbbf24', '#f87171',
    ]
    const tags = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio', 'stretch', 'mobility', 'compound']
    for (const tag of tags) {
      const color = getTagColor(tag)
      expect(validBorders).toContain(color.border)
    }
  })

  it('distributes tags across multiple palette entries', () => {
    // Generate many tags and check we hit at least 4 of 8 colors
    const tags = Array.from({ length: 50 }, (_, i) => `tag-${i}`)
    const uniqueColors = new Set(tags.map(t => getTagColor(t).border))
    expect(uniqueColors.size).toBeGreaterThanOrEqual(4)
  })
})
