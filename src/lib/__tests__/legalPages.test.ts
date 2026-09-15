import { describe, it, expect } from 'vitest'
import legalPagesPlugin, { renderLegalPage, LEGAL_PAGE_PATHS } from '../../../vite-plugin-legal-pages'
import { LEGAL_DOCUMENTS, LEGAL_UPDATED, LEGAL_CONTACT_EMAIL, PRIVACY_POLICY } from '../legalCopy'

/**
 * #537: the public Privacy Policy / Terms pages App Store Connect points at
 * are generated from the same source as the in-app sheet. Pins: every section
 * and every sentence of the source reaches the page (escaped), the page is a
 * standalone document, and the policy says what the app actually does.
 */

const allText = (sections: typeof PRIVACY_POLICY) =>
  sections.flatMap(s => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? []).flatMap(i => [i.term, i.text])])

describe('renderLegalPage (#537)', () => {
  it.each(['privacy', 'terms'] as const)('%s: a standalone HTML document carrying every section of the source', (kind) => {
    const html = renderLegalPage(kind)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain(`<title>${LEGAL_DOCUMENTS[kind].title} · Lift</title>`)
    expect(html).toContain(`Last updated ${LEGAL_UPDATED}`)
    expect(html).not.toContain('<script')
    for (const text of allText(LEGAL_DOCUMENTS[kind].sections)) {
      // The renderer escapes; compare against the escaped form of each string.
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      expect(html, text.slice(0, 40)).toContain(escaped)
    }
  })

  it('escapes markup instead of interpreting it', () => {
    const html = renderLegalPage('terms')
    // The liability clause quotes "as is" — must arrive as &quot; inside text, never break an attribute.
    expect(html).toContain('provided &quot;as is&quot;')
  })

  it('the two pages link to each other and back to the app', () => {
    expect(renderLegalPage('privacy')).toContain(`href="/${LEGAL_DOCUMENTS.terms.path}"`)
    expect(renderLegalPage('terms')).toContain(`href="/${LEGAL_DOCUMENTS.privacy.path}"`)
    expect(renderLegalPage('privacy')).toContain('href="/"')
  })
})

describe('the Privacy Policy says what the app actually does', () => {
  const policy = allText(PRIVACY_POLICY).join('\n')

  it('names every third party the app talks to', () => {
    for (const party of ['Supabase', 'Vercel', 'Sentry', 'Anthropic', 'Apple Health', 'Google']) {
      expect(policy).toContain(party)
    }
  })

  it('covers HealthKit honestly: write-only weight, reads back only its own samples, no other Health data', () => {
    expect(policy).toMatch(/permission to write weight/)
    expect(policy).toMatch(/samples it wrote itself/)
    expect(policy).toMatch(/never reads any other Health data/)
  })

  it('covers the AI coach: off by default, what is sent, identifiers never included', () => {
    expect(policy).toMatch(/off by default/)
    expect(policy).toMatch(/Anthropic/)
    expect(policy).toMatch(/never included/)
  })

  it('points at the in-app deletion path, not a "contact us" (#1299 made deletion self-serve)', () => {
    expect(policy).toContain('Delete Account')
    expect(policy).toContain('Delete All Data')
    expect(policy).not.toMatch(/contact us at .* to delete/i)
  })

  it('states no selling, no ads, no tracking, and the children rule', () => {
    expect(policy).toMatch(/does not sell your data/)
    expect(policy).toMatch(/tracking of any kind/)
    expect(policy).toMatch(/children under 13/)
  })

  it('carries a reachable contact', () => {
    expect(policy).toContain(LEGAL_CONTACT_EMAIL)
    expect(LEGAL_CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
  })

  it('has a real date', () => {
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(LEGAL_UPDATED))).toBe(false)
  })
})

describe('legalPagesPlugin', () => {
  it('emits both pages at the paths the policy URL and the SPA-fallback exclusion assume', () => {
    const emitted: Array<{ fileName: string; source: string }> = []
    const plugin = legalPagesPlugin()
    const generateBundle = plugin.generateBundle as unknown as (this: { emitFile: (f: { type: string; fileName: string; source: string }) => void }) => void
    generateBundle.call({ emitFile: (f) => emitted.push({ fileName: f.fileName, source: f.source }) })
    expect(emitted.map(e => e.fileName).sort()).toEqual(['legal/privacy.html', 'legal/terms.html'])
    expect(LEGAL_PAGE_PATHS.privacy).toBe('legal/privacy.html')
    expect(emitted.find(e => e.fileName === 'legal/privacy.html')!.source).toContain('Privacy Policy')
    expect(plugin.apply).toBe('build')
  })
})
