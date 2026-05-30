import type { ThemeId } from './themes'

/**
 * Alternate app-icon catalog.
 *
 * Each elemental theme has a matching home-screen icon. Picking an alternate
 * icon is a native-only capability (iOS `setAlternateIconName`) — the picker is
 * hidden on web/PWA where alternate icons cannot be applied. Icons are unlocked
 * alongside their matching theme, reusing the existing XP progression model
 * rather than introducing a parallel entitlement.
 *
 * The pure catalog + unlock policy lives here so it can be tested independently
 * of the native bridge. The iOS asset-catalog wiring (CFBundleAlternateIcons)
 * and on-device verification are handled in the Capacitor iOS build (#531/#216).
 */

/** Identifier for an alternate app icon. `'default'` = the primary app icon. */
export type AppIconId = 'default' | ThemeId

export interface AppIconOption {
  /** Stable id persisted in preferences. */
  id: AppIconId
  /** User-facing label shown in the picker. */
  label: string
  /**
   * iOS alternate-icon name as configured in the asset catalog
   * (`CFBundleAlternateIcons`). `null` selects the primary icon.
   */
  nativeName: string | null
  /**
   * Theme whose unlock gates this icon. `null` means always available.
   * The default icon is always available; themed icons unlock with their theme.
   */
  requiresTheme: ThemeId | null
  /** Theme id used to render the gradient swatch in the in-app picker. */
  previewTheme: ThemeId
}

export const DEFAULT_APP_ICON_ID: AppIconId = 'default'

export const APP_ICONS: AppIconOption[] = [
  { id: 'default',  label: 'Classic',    nativeName: null,              requiresTheme: null,       previewTheme: 'eternal' },
  { id: 'fire',     label: 'Intensity',  nativeName: 'AppIcon-fire',     requiresTheme: 'fire',     previewTheme: 'fire' },
  { id: 'water',    label: 'Flow',       nativeName: 'AppIcon-water',    requiresTheme: 'water',    previewTheme: 'water' },
  { id: 'luck',     label: 'Luck',       nativeName: 'AppIcon-luck',     requiresTheme: 'luck',     previewTheme: 'luck' },
  { id: 'air',      label: 'Energy',     nativeName: 'AppIcon-air',      requiresTheme: 'air',      previewTheme: 'air' },
  { id: 'amethyst', label: 'Focus',      nativeName: 'AppIcon-amethyst', requiresTheme: 'amethyst', previewTheme: 'amethyst' },
  { id: 'midnight', label: 'Fortitude',  nativeName: 'AppIcon-midnight', requiresTheme: 'midnight', previewTheme: 'midnight' },
  { id: 'earth',    label: 'Stability',  nativeName: 'AppIcon-earth',    requiresTheme: 'earth',    previewTheme: 'earth' },
  { id: 'love',     label: 'Love',       nativeName: 'AppIcon-love',     requiresTheme: 'love',     previewTheme: 'love' },
  { id: 'pearl',    label: 'Origin',     nativeName: 'AppIcon-pearl',    requiresTheme: 'pearl',    previewTheme: 'pearl' },
  { id: 'eternal',  label: 'Eternal',    nativeName: 'AppIcon-eternal',  requiresTheme: 'eternal',  previewTheme: 'eternal' },
]

/** Look up an icon option by id, falling back to the default icon. */
export function getAppIcon(id: string): AppIconOption {
  return APP_ICONS.find(icon => icon.id === id) ?? APP_ICONS[0]
}

/** Whether an icon is unlocked given the set of unlocked theme ids. */
export function isAppIconUnlocked(icon: AppIconOption, unlockedThemeIds: readonly ThemeId[]): boolean {
  return icon.requiresTheme === null || unlockedThemeIds.includes(icon.requiresTheme)
}

/** The subset of icons currently available to the user. */
export function getUnlockedAppIcons(unlockedThemeIds: readonly ThemeId[]): AppIconOption[] {
  return APP_ICONS.filter(icon => isAppIconUnlocked(icon, unlockedThemeIds))
}

/**
 * Resolve a stored icon id to one the user is actually allowed to use.
 * Falls back to the default icon if the stored id is unknown or its theme is
 * no longer unlocked (e.g. after a progression/prestige reset).
 */
export function resolveAppIconId(id: string, unlockedThemeIds: readonly ThemeId[]): AppIconId {
  const icon = APP_ICONS.find(i => i.id === id)
  if (icon && isAppIconUnlocked(icon, unlockedThemeIds)) return icon.id
  return DEFAULT_APP_ICON_ID
}
