import { describe, it, expect } from 'vitest'
import {
  THEMES, THEME_MIGRATION, THEME_META_COLORS, THEME_PREVIEWS,
  COLOR_MODES, WEIGHT_UNITS,
  DEFAULT_THEME_ID, DEFAULT_COLOR_MODE, DEFAULT_WEIGHT_UNIT,
  sanitizeThemeId, sanitizeColorMode, sanitizeWeightUnit,
} from '../themes'
import { APP_ICONS, DEFAULT_APP_ICON_ID, sanitizeAppIconId } from '../appIcons'

/**
 * LIFT-1494 — the four appearance settings (theme, colour mode, weight unit,
 * app icon) were typed as bare `string` in the preferences store and re-narrowed
 * by unchecked cast at every accessor, so a corrupt or future-version value from
 * the blob reached the UI intact: an unknown theme id landed on `data-theme`
 * with no matching palette, and an unknown weight unit rendered as the visible
 * unit LABEL while every conversion quietly did lbs math against it.
 *
 * The guards below are DERIVED from the catalogs (`THEMES`, `THEME_MIGRATION`,
 * `APP_ICONS`, `COLOR_MODES`, `WEIGHT_UNITS`) rather than restating a list of
 * legal ids: a hardcoded list would only ever pin the values that existed when
 * it was written, which is the enumeration-drift class this repo keeps paying
 * for (REPLAYABLE_COLUMNS, LOCAL_ONLY_SET_FIELDS, EXERCISE_MERGE_RULES). A new
 * theme or a new legacy alias joins these assertions by being added to the
 * catalog.
 */
describe('appearance sanitizers (LIFT-1494)', () => {
  // A value that is not a string at all — the shape a hand-edited or
  // partially-written JSON blob can actually produce.
  const NON_STRINGS: unknown[] = [null, undefined, 0, 1, true, false, {}, [], NaN]

  describe('sanitizeThemeId', () => {
    it('accepts every id in the catalog, unchanged', () => {
      expect(THEMES.length).toBeGreaterThan(0)
      for (const theme of THEMES) {
        expect(sanitizeThemeId(theme.id)).toBe(theme.id)
      }
    })

    it('migrates every legacy id in THEME_MIGRATION to a real theme', () => {
      const legacyIds = Object.keys(THEME_MIGRATION)
      expect(legacyIds.length).toBeGreaterThan(0)
      for (const legacy of legacyIds) {
        const migrated = sanitizeThemeId(legacy)
        expect(migrated).toBe(THEME_MIGRATION[legacy])
        // A migration table entry pointing at a theme that no longer exists
        // would silently degrade to the default — catch it here rather than as
        // an unexplained theme reset on a returning user's device.
        expect(THEMES.some(t => t.id === migrated)).toBe(true)
      }
    })

    it('falls back to the default for an unknown or non-string id', () => {
      expect(sanitizeThemeId('future-theme')).toBe(DEFAULT_THEME_ID)
      expect(sanitizeThemeId('')).toBe(DEFAULT_THEME_ID)
      // A removed theme id: 'graphite' migrates, but a genuinely dropped one
      // has no entry and must not reach the DOM.
      expect(sanitizeThemeId('rainbow')).toBe(DEFAULT_THEME_ID)
      for (const value of NON_STRINGS) {
        expect(sanitizeThemeId(value)).toBe(DEFAULT_THEME_ID)
      }
    })

    it('always returns an id every theme-keyed lookup table can answer', () => {
      // The sanitized value indexes THEME_META_COLORS (meta theme-colour) and
      // THEME_PREVIEWS (picker swatches) with no `??` fallback of their own.
      for (const value of ['fire', 'void', 'future-theme', '', null, 42] as unknown[]) {
        const id = sanitizeThemeId(value)
        expect(THEME_META_COLORS[id]).toBeDefined()
        expect(THEME_PREVIEWS[id]).toBeDefined()
      }
    })
  })

  describe('sanitizeColorMode', () => {
    it('accepts every mode the app can render', () => {
      expect(COLOR_MODES.length).toBe(3)
      for (const mode of COLOR_MODES) expect(sanitizeColorMode(mode)).toBe(mode)
    })

    it('falls back to the default for anything else', () => {
      expect(sanitizeColorMode('sepia')).toBe(DEFAULT_COLOR_MODE)
      expect(sanitizeColorMode('Dark')).toBe(DEFAULT_COLOR_MODE)
      for (const value of NON_STRINGS) expect(sanitizeColorMode(value)).toBe(DEFAULT_COLOR_MODE)
    })
  })

  describe('sanitizeWeightUnit', () => {
    it('accepts every unit the conversion helpers implement', () => {
      expect(WEIGHT_UNITS.length).toBe(2)
      for (const unit of WEIGHT_UNITS) expect(sanitizeWeightUnit(unit)).toBe(unit)
    })

    it('falls back to lbs for a plausible-looking but wrong value', () => {
      // The issue's own example: 'pounds' used to render as the unit label while
      // displayWeight() fell through to the lbs branch.
      expect(sanitizeWeightUnit('pounds')).toBe(DEFAULT_WEIGHT_UNIT)
      expect(sanitizeWeightUnit('KG')).toBe(DEFAULT_WEIGHT_UNIT)
      expect(sanitizeWeightUnit('stone')).toBe(DEFAULT_WEIGHT_UNIT)
      for (const value of NON_STRINGS) expect(sanitizeWeightUnit(value)).toBe(DEFAULT_WEIGHT_UNIT)
    })
  })

  describe('sanitizeAppIconId', () => {
    it('accepts every id in the catalog, unchanged', () => {
      expect(APP_ICONS.length).toBeGreaterThan(0)
      for (const icon of APP_ICONS) expect(sanitizeAppIconId(icon.id)).toBe(icon.id)
    })

    it('falls back to the default icon for an unknown or non-string id', () => {
      expect(sanitizeAppIconId('AppIcon-fire')).toBe(DEFAULT_APP_ICON_ID)
      expect(sanitizeAppIconId('bogus')).toBe(DEFAULT_APP_ICON_ID)
      for (const value of NON_STRINGS) expect(sanitizeAppIconId(value)).toBe(DEFAULT_APP_ICON_ID)
    })
  })

  // The defaults are what the sanitizers fall back to AND what the store's
  // state factory seeds, so a default that isn't itself a catalog member would
  // make a fresh install unrenderable.
  describe('defaults are themselves legal', () => {
    it('names a real theme, mode, unit and icon', () => {
      expect(THEMES.some(t => t.id === DEFAULT_THEME_ID)).toBe(true)
      expect(COLOR_MODES).toContain(DEFAULT_COLOR_MODE)
      expect(WEIGHT_UNITS).toContain(DEFAULT_WEIGHT_UNIT)
      expect(APP_ICONS.some(i => i.id === DEFAULT_APP_ICON_ID)).toBe(true)
    })

    it('is a fixed point of its own sanitizer', () => {
      expect(sanitizeThemeId(DEFAULT_THEME_ID)).toBe(DEFAULT_THEME_ID)
      expect(sanitizeColorMode(DEFAULT_COLOR_MODE)).toBe(DEFAULT_COLOR_MODE)
      expect(sanitizeWeightUnit(DEFAULT_WEIGHT_UNIT)).toBe(DEFAULT_WEIGHT_UNIT)
      expect(sanitizeAppIconId(DEFAULT_APP_ICON_ID)).toBe(DEFAULT_APP_ICON_ID)
    })
  })
})
