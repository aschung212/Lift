/**
 * Dynamic theme CSS loader.
 *
 * Instead of bundling all 10 theme variants (dark+light = 20 rule sets) into
 * the main CSS bundle, each theme is a separate CSS file loaded on demand.
 * The default theme (eternal) is inlined in index.css as a fallback so there's
 * no flash for new/default users.
 *
 * Vite's `import.meta.glob` with `?url` gives us hashed asset URLs at build
 * time, so the theme files are properly cache-busted.
 */

// Eagerly resolve all theme CSS file URLs at build time
const themeModules = import.meta.glob('../themes/*.css', { query: '?url', eager: true }) as Record<string, { default: string }>

// Build a clean map: theme ID → asset URL
const themeUrls: Record<string, string> = {}
for (const [path, mod] of Object.entries(themeModules)) {
  const match = path.match(/\/(\w+)\.css$/)
  if (match) {
    themeUrls[match[1]] = mod.default
  }
}

const LINK_ID = 'lift-theme-css'

let currentThemeId: string | null = null

/**
 * Load a theme CSS file by injecting/swapping a <link> element.
 * Returns a promise that resolves when the stylesheet is loaded.
 *
 * On error, reverts to the eternal fallback theme to prevent unstyled state.
 * The data-theme attribute is only updated AFTER CSS loads successfully,
 * preventing FOUC for non-default themes.
 */
export function loadThemeCSS(themeId: string): Promise<void> {
  if (themeId === currentThemeId) return Promise.resolve()

  const url = themeUrls[themeId]
  if (!url) {
    // Unknown theme or eternal (already inline) — no-op
    return Promise.resolve()
  }

  // For eternal, CSS is already inline — just track it
  if (themeId === 'eternal') {
    currentThemeId = 'eternal'
    return Promise.resolve()
  }

  currentThemeId = themeId

  return new Promise<void>((resolve) => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null

    if (link) {
      // Swap href on existing link — bind new handlers for the new URL
      const onLoad = () => {
        link!.removeEventListener('load', onLoad)
        link!.removeEventListener('error', onError)
        resolve()
      }
      const onError = () => {
        link!.removeEventListener('load', onLoad)
        link!.removeEventListener('error', onError)
        // Revert to eternal fallback so the app stays usable
        revertToEternal()
        resolve()
      }
      link.addEventListener('load', onLoad)
      link.addEventListener('error', onError)
      link.href = url
    } else {
      // First load — create the link element
      link = document.createElement('link')
      link.id = LINK_ID
      link.rel = 'stylesheet'
      link.href = url
      link.onload = () => resolve()
      link.onerror = () => {
        // Revert to eternal fallback so the app stays usable
        revertToEternal()
        resolve()
      }
      document.head.appendChild(link)
    }
  })
}

/**
 * Revert to the eternal theme (inline CSS) on load failure.
 * This ensures the app never ends up in an unstyled state.
 */
function revertToEternal(): void {
  currentThemeId = 'eternal'
  document.documentElement.setAttribute('data-theme', 'eternal')
  // Remove the broken link element
  const link = document.getElementById(LINK_ID)
  if (link) link.remove()
}

/**
 * Preload a theme CSS file without applying it.
 * Used during theme picker hover/preview for instant switch.
 */
export function preloadThemeCSS(themeId: string): void {
  const url = themeUrls[themeId]
  if (!url) return

  // Check if already preloaded
  if (document.querySelector(`link[rel="preload"][href="${url}"]`)) return

  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'style'
  link.href = url
  document.head.appendChild(link)
}

/** Get all available theme IDs that have CSS files */
export function getAvailableThemeIds(): string[] {
  return Object.keys(themeUrls)
}
