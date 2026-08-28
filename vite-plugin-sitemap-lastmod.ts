/**
 * Vite plugin: stamp a build-time `<lastmod>` into sitemap.xml.
 *
 * public/sitemap.xml is copied verbatim into the build output, so its
 * `<lastmod>` would freeze at whatever date is committed to the repo. Google
 * has stated it *uses* `<lastmod>` to schedule recrawls but *ignores*
 * `<changefreq>`/`<priority>` — a stale lastmod tells Google the page hasn't
 * changed since that date, delaying recrawls after a deploy.
 *
 * This plugin rewrites the emitted `dist/sitemap.xml` in `closeBundle` (which
 * runs after Vite copies the public dir) so the `<lastmod>` reflects the actual
 * build/deploy date. The committed static file keeps a valid date so it is
 * correct on its own in dev and for the source-level regression tests.
 *
 * The date is date-only W3C Datetime (`YYYY-MM-DD`) — the format Google's
 * examples use — so it doesn't churn within a single deploy day.
 */
import type { Plugin } from 'vite'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Return `xml` with its `<lastmod>` set to `isoDate`.
 *
 * Pure and idempotent — exported for unit testing. If a `<lastmod>` already
 * exists it is replaced (every occurrence); otherwise one is inserted directly
 * after the first `<loc>`, preserving that line's indentation.
 */
export function injectSitemapLastmod(xml: string, isoDate: string): string {
  const lastmodTag = `<lastmod>${isoDate}</lastmod>`
  if (/<lastmod>[^<]*<\/lastmod>/.test(xml)) {
    return xml.replace(/<lastmod>[^<]*<\/lastmod>/g, lastmodTag)
  }
  return xml.replace(
    /([ \t]*)(<loc>[^<]*<\/loc>)/,
    (_match, indent: string, loc: string) => `${indent}${loc}\n${indent}${lastmodTag}`,
  )
}

/** Today's date as a date-only W3C Datetime string (`YYYY-MM-DD`). */
export function buildDateISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export default function sitemapLastmodPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'lift-sitemap-lastmod',
    apply: 'build', // The static committed file already carries a valid date.
    configResolved(config) {
      outDir = config.build.outDir
    },
    // closeBundle runs after Vite copies the public dir into the output.
    closeBundle() {
      const sitemapPath = resolve(outDir, 'sitemap.xml')
      if (!existsSync(sitemapPath)) return
      const xml = readFileSync(sitemapPath, 'utf-8')
      const stamped = injectSitemapLastmod(xml, buildDateISO())
      if (stamped !== xml) writeFileSync(sitemapPath, stamped)
    },
  }
}
