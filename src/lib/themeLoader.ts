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
 */
export function loadThemeCSS(themeId: string): Promise<void> {
  if (themeId === currentThemeId) return Promise.resolve()

  const url = themeUrls[themeId]
  if (!url) {
    // Unknown theme — no-op (eternal inline fallback will cover)
    return Promise.resolve()
  }

  currentThemeId = themeId

  return new Promise<void>((resolve) => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null

    if (link) {
      // Swap href on existing link
      link.href = url
      // Resolve immediately — CSS files are tiny (~2KB) and likely cached
      resolve()
    } else {
      // First load — create the link element
      link = document.createElement('link')
      link.id = LINK_ID
      link.rel = 'stylesheet'
      link.href = url
      link.onload = () => resolve()
      link.onerror = () => resolve() // Fallback to inline eternal on error
      document.head.appendChild(link)
    }
  })
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
