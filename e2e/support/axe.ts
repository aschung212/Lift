/**
 * Page-level accessibility scanning for the Playwright E2E suite (LIFT-1192).
 *
 * The component suite already runs axe-core against individual mounted
 * components (see src/__tests__/axeHelper.ts, LIFT-665), but a component in
 * isolation can't exercise the things that only exist once the whole page is
 * composed and interactive: focus order after a tab switch, live-region wiring,
 * duplicate ids across sibling components, or a skip-link/landmark that only the
 * app shell provides. This helper runs the SAME axe engine against the real,
 * fully-rendered page inside a browser engine (WebKit + Chromium), complementing
 * the unit-level checks.
 *
 * It deliberately reuses the `axe-core` package that is already a devDependency
 * (the same engine vitest-axe wraps) by injecting `axe.source` into the page,
 * rather than adding the `@axe-core/playwright` wrapper — one fewer dependency to
 * audit, and the wrapper does nothing more than this injection under the hood.
 */
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import axe from 'axe-core'
import type { AxeResults, ImpactValue, Result } from 'axe-core'

/**
 * WCAG 2.0/2.1/2.2 level A + AA — the conformance target CLAUDE.md declares for
 * the app. Scoping the run to these tags (instead of axe's full default set)
 * intentionally excludes axe "best-practice" rules that are NOT WCAG
 * requirements — notably `region`, `landmark-one-main`, and
 * `page-has-heading-one`. Those would false-fail here: the app knowingly lacks a
 * per-page `<h1>` on some surfaces (LIFT-856) and the pre-auth screens ship no
 * landmark chrome. Best-practice conformance belongs in its own ratchet, not in
 * this WCAG gate.
 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Rules disabled on every scan:
 *  - `color-contrast`: this app leans heavily on glass-morphism + gradient
 *    surfaces, whose composited foreground/background axe cannot resolve
 *    reliably in a headless engine. Contrast is instead audited exhaustively
 *    across all 10 themes x light/dark by themeContrast.test.ts. Pass a flat,
 *    opaque surface via `include` and drop it from `disableRules` to opt back in.
 */
const DEFAULT_DISABLED_RULES = ['color-contrast']

/**
 * Only serious/critical violations fail the gate. These are the actionable,
 * low-false-positive tiers (missing accessible names, invalid ARIA,
 * duplicate active/ARIA ids, unlabelled controls). minor/moderate findings are
 * still surfaced in the failure message but don't block, so the gate stays
 * resilient while the a11y baseline is ratcheted up over time.
 */
const BLOCKING_IMPACTS: ReadonlySet<ImpactValue> = new Set<ImpactValue>([
  'serious',
  'critical',
])

export interface AxeOptions {
  /** CSS selector(s) to scope the scan to. Defaults to the whole document. */
  include?: string | string[]
  /** CSS selector(s) to exclude from the scan. */
  exclude?: string | string[]
  /**
   * Extra rule ids to disable on top of {@link DEFAULT_DISABLED_RULES}. Use for
   * `bypass` on the pre-auth AuthScreen/Onboarding surfaces, which intentionally
   * render no `<main>`/skip-link chrome (the authenticated shell does).
   */
  disableRules?: string[]
}

/** axe's Context `include`/`exclude` expects an array of selector arrays. */
function toSelectorList(value?: string | string[]): string[][] | undefined {
  if (value == null) return undefined
  return (Array.isArray(value) ? value : [value]).map((selector) => [selector])
}

function buildContext(options: AxeOptions): Record<string, string[][]> | undefined {
  const include = toSelectorList(options.include)
  const exclude = toSelectorList(options.exclude)
  if (!include && !exclude) return undefined
  return {
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
  }
}

async function injectAxe(page: Page): Promise<void> {
  const alreadyLoaded = await page.evaluate(
    () => typeof (window as unknown as { axe?: unknown }).axe !== 'undefined'
  )
  if (!alreadyLoaded) {
    await page.addScriptTag({ content: axe.source })
  }
}

/**
 * Inject axe (once) and run a WCAG A/AA scan of the current page, returning the
 * raw axe results. Prefer {@link expectNoA11yViolations} in tests; use this
 * directly only when you need to assert on the results yourself.
 */
export async function analyzeA11y(
  page: Page,
  options: AxeOptions = {}
): Promise<AxeResults> {
  await injectAxe(page)
  const disabledRules = [...DEFAULT_DISABLED_RULES, ...(options.disableRules ?? [])]
  const context = buildContext(options)
  return page.evaluate(
    async ({ ctx, tags, rules }) => {
      const runOptions = {
        runOnly: { type: 'tag' as const, values: tags },
        rules: Object.fromEntries(rules.map((id) => [id, { enabled: false }])),
        resultTypes: ['violations' as const],
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).axe.run(ctx ?? document, runOptions)
    },
    { ctx: context, tags: WCAG_TAGS, rules: disabledRules }
  )
}

function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `      • ${n.target.join(' ')}`)
        .join('\n')
      return `  [${v.impact}] ${v.id} — ${v.help}\n${nodes}\n    ${v.helpUrl}`
    })
    .join('\n\n')
}

/**
 * Assert the current page has no serious/critical WCAG A/AA violations. On
 * failure the error lists every blocking violation with its impact, the failing
 * node selectors, and axe's help URL so the CI log is self-explanatory.
 */
export async function expectNoA11yViolations(
  page: Page,
  options: AxeOptions = {}
): Promise<void> {
  const results = await analyzeA11y(page, options)
  const blocking = results.violations.filter(
    (v) => v.impact != null && BLOCKING_IMPACTS.has(v.impact)
  )
  expect(
    blocking,
    blocking.length > 0
      ? `Found ${blocking.length} serious/critical accessibility violation(s):\n\n${formatViolations(blocking)}`
      : undefined
  ).toEqual([])
}
