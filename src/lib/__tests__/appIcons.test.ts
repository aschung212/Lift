import { describe, it, expect } from 'vitest'
import {
  APP_ICONS,
  DEFAULT_APP_ICON_ID,
  getAppIcon,
  isAppIconUnlocked,
  getUnlockedAppIcons,
  resolveAppIconId,
} from '../appIcons'
import { THEMES, type ThemeId } from '../themes'

describe('app icon catalog', () => {
  it('includes a default icon that is always available', () => {
    const def = APP_ICONS.find(i => i.id === DEFAULT_APP_ICON_ID)
    expect(def).toBeDefined()
    expect(def!.requiresTheme).toBeNull()
    expect(def!.nativeName).toBeNull()
  })

  it('has unique ids', () => {
    const ids = APP_ICONS.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('provides one icon per theme plus the default', () => {
    const themeIds = THEMES.map(t => t.id)
    const themedIcons = APP_ICONS.filter(i => i.id !== DEFAULT_APP_ICON_ID)
    for (const themeId of themeIds) {
      expect(themedIcons.some(i => i.id === themeId)).toBe(true)
    }
    expect(APP_ICONS).toHaveLength(themeIds.length + 1)
  })

  it('gates each themed icon on its own theme and gives it a native name', () => {
    for (const icon of APP_ICONS) {
      if (icon.id === DEFAULT_APP_ICON_ID) continue
      expect(icon.requiresTheme).toBe(icon.id)
      expect(icon.nativeName).toBeTruthy()
    }
  })

  it('references real theme previews for every swatch', () => {
    const themeIds = new Set<ThemeId>(THEMES.map(t => t.id))
    for (const icon of APP_ICONS) {
      expect(themeIds.has(icon.previewTheme)).toBe(true)
    }
  })
})

describe('getAppIcon', () => {
  it('returns the matching option', () => {
    expect(getAppIcon('fire').id).toBe('fire')
  })

  it('falls back to the default for unknown ids', () => {
    expect(getAppIcon('nonexistent').id).toBe(DEFAULT_APP_ICON_ID)
  })
})

describe('isAppIconUnlocked', () => {
  it('treats the default icon as always unlocked', () => {
    expect(isAppIconUnlocked(getAppIcon('default'), [])).toBe(true)
  })

  it('locks a themed icon until its theme is unlocked', () => {
    const fire = getAppIcon('fire')
    expect(isAppIconUnlocked(fire, [])).toBe(false)
    expect(isAppIconUnlocked(fire, ['fire'])).toBe(true)
  })

  it('does not unlock an icon from an unrelated theme', () => {
    expect(isAppIconUnlocked(getAppIcon('love'), ['fire', 'water'])).toBe(false)
  })
})

describe('getUnlockedAppIcons', () => {
  it('returns only the default when no themes are unlocked', () => {
    const unlocked = getUnlockedAppIcons([])
    expect(unlocked.map(i => i.id)).toEqual([DEFAULT_APP_ICON_ID])
  })

  it('includes themed icons for unlocked themes', () => {
    const unlocked = getUnlockedAppIcons(['fire', 'water'])
    const ids = unlocked.map(i => i.id)
    expect(ids).toContain('default')
    expect(ids).toContain('fire')
    expect(ids).toContain('water')
    expect(ids).not.toContain('love')
  })
})

describe('resolveAppIconId', () => {
  it('keeps a valid, unlocked selection', () => {
    expect(resolveAppIconId('fire', ['fire'])).toBe('fire')
  })

  it('falls back to default when the theme is no longer unlocked (e.g. prestige reset)', () => {
    expect(resolveAppIconId('fire', [])).toBe(DEFAULT_APP_ICON_ID)
  })

  it('falls back to default for an unknown id', () => {
    expect(resolveAppIconId('bogus', ['fire'])).toBe(DEFAULT_APP_ICON_ID)
  })
})
