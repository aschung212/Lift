import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')

describe('vite.config.js regression', () => {
  it('should only generate source maps when SENTRY_AUTH_TOKEN is set', () => {
    // Source maps are ~1.75MB and should only be generated when Sentry will upload
    // and delete them. When SENTRY_AUTH_TOKEN is missing, they ship to production.
    // See: LIFT-482
    expect(viteConfig).toContain('sourcemap: !!process.env.SENTRY_AUTH_TOKEN')
    expect(viteConfig).not.toMatch(/sourcemap:\s*true/)
  })

  it('should conditionally include sentry plugin only when auth token exists', () => {
    expect(viteConfig).toContain('process.env.SENTRY_AUTH_TOKEN')
    expect(viteConfig).toContain('filesToDeleteAfterUpload')
  })

  it('should wire the default-view preload plugin into the build', () => {
    // Removes the first-paint request waterfall for the always-rendered Workouts
    // tab by emitting a <link rel="modulepreload"> for its lazy chunk. See LIFT-940.
    expect(viteConfig).toContain('preloadDefaultViewPlugin')
    expect(viteConfig).toContain("from './vite-plugin-preload-default-view'")
  })

  it('should wire the sitemap lastmod plugin into the build', () => {
    // Stamps a build-time <lastmod> into dist/sitemap.xml so Google can schedule
    // recrawls accurately after each deploy. See LIFT-1001.
    expect(viteConfig).toContain('sitemapLastmodPlugin')
    expect(viteConfig).toContain("from './vite-plugin-sitemap-lastmod'")
  })
})
