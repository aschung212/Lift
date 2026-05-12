/**
 * Vite plugin: strip non-default theme tokens from the main CSS bundle.
 *
 * During development, all themes remain in index.css for instant switching.
 * In production builds, this plugin removes non-eternal theme blocks from
 * the main CSS output — they're loaded on demand via themeLoader.ts instead.
 *
 * This reduces the main CSS bundle from ~120KB to ~85KB (saving ~35KB of
 * theme token definitions that are lazily loaded as separate ~2KB files).
 */
import type { Plugin } from 'vite'

const THEME_IDS_TO_STRIP = ['fire', 'water', 'luck', 'air', 'amethyst', 'pearl', 'midnight', 'love', 'earth']

/**
 * Build a regex that matches a complete CSS rule block for a given theme.
 * Matches: [data-theme="<id>"][data-mode="dark|light"] { ... }
 */
function buildThemeRegex(themeId: string): RegExp {
  // Match the selector + opening brace + everything up to the closing brace
  // Uses a non-greedy match that accounts for nested content (none expected in theme tokens)
  return new RegExp(
    `\\[data-theme="${themeId}"\\]\\[data-mode="(?:dark|light)"\\]\\s*\\{[^}]*\\}`,
    'g'
  )
}

export default function themeStripPlugin(): Plugin {
  return {
    name: 'lift-theme-strip',
    apply: 'build', // Only run during production builds
    enforce: 'post',

    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        // Only process the main CSS bundle (index-*.css), not the individual theme files
        if (chunk.type === 'asset' && fileName.endsWith('.css') && fileName.includes('index')) {
          let css = chunk.source as string
          let stripped = 0

          for (const themeId of THEME_IDS_TO_STRIP) {
            const regex = buildThemeRegex(themeId)
            const before = css.length
            css = css.replace(regex, '')
            if (css.length < before) stripped++
          }

          // Also strip the old section comments that reference removed themes
          css = css.replace(/\/\*\s*──[^*]*(?:Fire|Water|Luck|Air|Amethyst|Pearl|Midnight|Love|Earth|Oak|Moon|Sun|Arctic|Aaron|Tina|Graphite|Void)[^*]*──\s*\*\//g, '')

          // Clean up multiple consecutive blank lines left behind
          css = css.replace(/\n{3,}/g, '\n\n')

          chunk.source = css

          if (stripped > 0) {
            console.log(`[theme-strip] Removed ${stripped} theme rule blocks from ${fileName}`)
          }
        }
      }
    }
  }
}
