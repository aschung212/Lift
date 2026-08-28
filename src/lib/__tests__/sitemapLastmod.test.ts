import { describe, it, expect } from 'vitest'
import sitemapLastmodPlugin, {
  injectSitemapLastmod,
  buildDateISO,
} from '../../../vite-plugin-sitemap-lastmod'

const BASE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://spa-rho-sandy.vercel.app/</loc>
    <lastmod>2026-07-21</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`

describe('injectSitemapLastmod', () => {
  it('replaces an existing lastmod with the given date', () => {
    const out = injectSitemapLastmod(BASE, '2026-08-15')
    expect(out).toContain('<lastmod>2026-08-15</lastmod>')
    expect(out).not.toContain('<lastmod>2026-07-21</lastmod>')
  })

  it('preserves loc, changefreq and priority when replacing', () => {
    const out = injectSitemapLastmod(BASE, '2026-08-15')
    expect(out).toContain('<loc>https://spa-rho-sandy.vercel.app/</loc>')
    expect(out).toContain('<changefreq>weekly</changefreq>')
    expect(out).toContain('<priority>1.0</priority>')
  })

  it('inserts a lastmod after <loc> when none exists, matching indentation', () => {
    const noLastmod = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://spa-rho-sandy.vercel.app/</loc>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
`
    const out = injectSitemapLastmod(noLastmod, '2026-08-15')
    expect(out).toContain(
      '    <loc>https://spa-rho-sandy.vercel.app/</loc>\n    <lastmod>2026-08-15</lastmod>',
    )
  })

  it('is idempotent — reapplying the same date yields identical output', () => {
    const once = injectSitemapLastmod(BASE, '2026-08-15')
    const twice = injectSitemapLastmod(once, '2026-08-15')
    expect(twice).toBe(once)
  })

  it('never introduces a second lastmod element', () => {
    const out = injectSitemapLastmod(BASE, '2026-08-15')
    expect(out.match(/<lastmod>/g)?.length).toBe(1)
  })
})

describe('buildDateISO', () => {
  it('formats a date as date-only YYYY-MM-DD (W3C Datetime)', () => {
    expect(buildDateISO(new Date('2026-08-15T23:45:12.000Z'))).toBe('2026-08-15')
  })

  it('produces a valid date-only string for the current date by default', () => {
    expect(buildDateISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('sitemapLastmodPlugin', () => {
  it('only applies during build (the committed file is valid on its own)', () => {
    expect(sitemapLastmodPlugin().apply).toBe('build')
  })
})
