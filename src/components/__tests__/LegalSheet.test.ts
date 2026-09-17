import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import LegalSheet from '../LegalSheet.vue'
import { LEGAL_DOCUMENTS, LEGAL_UPDATED } from '../../lib/legalCopy'
import { runComponentAxe } from '../../__tests__/axeHelper'

/**
 * #537: the in-app Legal sheet renders src/lib/legalCopy.ts — the same source
 * the build emits as the public /legal/*.html pages — so the two cannot drift.
 */

enableAutoUnmount(afterEach)

function mountSheet(view: 'privacy' | 'terms' | null) {
  return mount(LegalSheet, {
    props: { view },
    attachTo: document.body,
    global: { stubs: { Teleport: true, Transition: false } },
  })
}

describe('LegalSheet', () => {
  it.each(['privacy', 'terms'] as const)('%s: renders the title, the date and every section of the shared source', (view) => {
    const w = mountSheet(view)
    const doc = LEGAL_DOCUMENTS[view]
    expect(w.find('#legal-title').text()).toBe(doc.title)
    expect(w.text()).toContain(`Last updated ${LEGAL_UPDATED}`)
    const headings = w.findAll('.legalH4').map(h => h.text())
    expect(headings).toEqual(doc.sections.map(s => s.heading))
    for (const section of doc.sections) {
      for (const p of section.paragraphs ?? []) expect(w.text()).toContain(p)
      for (const item of section.items ?? []) expect(w.text()).toContain(item.term)
    }
  })

  it('renders nothing while closed', () => {
    const w = mountSheet(null)
    expect(w.find('.legalSheet').exists()).toBe(false)
  })

  it('is a labelled modal dialog with no axe violations', async () => {
    const w = mountSheet('privacy')
    const dialog = w.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('legal-title')
    const results = await runComponentAxe(w.element)
    expect(results).toHaveNoViolations()
  })
})
