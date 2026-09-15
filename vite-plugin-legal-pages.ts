/**
 * Vite plugin: emit the Privacy Policy and Terms of Service as static pages
 * at /legal/privacy.html and /legal/terms.html (#537).
 *
 * App Store Connect, the App Privacy questionnaire and App Review all want a
 * public privacy-policy URL. The text already lived inside the app's Legal
 * sheet, and a second hand-written copy in public/ would drift from it the
 * first time a data flow changed — so both the sheet and these pages render
 * src/lib/legalCopy.ts, and the build emits the pages the way it emits
 * version.json (vite-plugin-version-stamp.ts). Plain HTML, inline CSS, no
 * script: the page has to work for a reviewer with everything else blocked.
 *
 * vercel.json's SPA fallback excludes the `legal/` prefix so a wrong path 404s
 * instead of answering the app shell with a 200 (#1155).
 */
import type { Plugin } from 'vite'
import { LEGAL_DOCUMENTS, LEGAL_UPDATED, type LegalDocumentKind, type LegalSection } from './src/lib/legalCopy'

export const LEGAL_PAGE_PATHS: Record<LegalDocumentKind, string> = {
  privacy: LEGAL_DOCUMENTS.privacy.path,
  terms: LEGAL_DOCUMENTS.terms.path,
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderSection(section: LegalSection): string {
  const paragraphs = (section.paragraphs ?? []).map((p) => `      <p>${escapeHtml(p)}</p>`)
  const items = section.items?.length
    ? [
        '      <ul>',
        ...section.items.map((item) => `        <li><strong>${escapeHtml(item.term)}</strong> — ${escapeHtml(item.text)}</li>`),
        '      </ul>',
      ]
    : []
  return [`      <h2>${escapeHtml(section.heading)}</h2>`, ...paragraphs, ...items].join('\n')
}

/** Pure renderer — exported for tests. */
export function renderLegalPage(kind: LegalDocumentKind, updated: string = LEGAL_UPDATED): string {
  const doc = LEGAL_DOCUMENTS[kind]
  const other = LEGAL_DOCUMENTS[kind === 'privacy' ? 'terms' : 'privacy']
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(doc.title)} · Lift</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 32px 20px 64px; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1c1e; background: #ffffff; }
    main { max-width: 680px; margin: 0 auto; }
    a { color: #b8860b; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; }
    p, li { margin: 0 0 12px; }
    ul { padding-left: 20px; }
    .meta { color: #6e6e73; font-size: 14px; margin-bottom: 24px; }
    .brand { display: inline-block; margin-bottom: 24px; font-weight: 700; text-decoration: none; color: inherit; }
    footer { margin-top: 40px; font-size: 14px; color: #6e6e73; }
    @media (prefers-color-scheme: dark) {
      body { color: #f2f2f7; background: #0f0f0f; }
      a { color: #d4af37; }
      .meta, footer { color: #a1a1a6; }
    }
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/">Lift</a>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="meta">Last updated ${escapeHtml(updated)}</p>
${doc.sections.map(renderSection).join('\n')}
    <footer>See also the <a href="/${other.path}">${escapeHtml(other.title)}</a>.</footer>
  </main>
</body>
</html>
`
}

export default function legalPagesPlugin(): Plugin {
  return {
    name: 'lift-legal-pages',
    apply: 'build',
    generateBundle() {
      for (const kind of Object.keys(LEGAL_DOCUMENTS) as LegalDocumentKind[]) {
        this.emitFile({ type: 'asset', fileName: LEGAL_PAGE_PATHS[kind], source: renderLegalPage(kind) })
      }
    },
  }
}
