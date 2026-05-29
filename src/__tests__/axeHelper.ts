/**
 * Shared axe-core helper for automated accessibility assertions.
 *
 * Replaces hand-written aria-attribute checks (which only catch the specific
 * attributes an author thought to verify) with a full WCAG ruleset audit via
 * axe-core. See LIFT-665.
 *
 * Two categories of rules are disabled because they cannot be evaluated
 * meaningfully in this environment:
 *
 *  - `color-contrast`: happy-dom does not perform real layout/rendering, so
 *    axe cannot compute foreground/background colors. Contrast is already
 *    covered exhaustively by themeContrast.test.ts (all 10 themes x light/dark
 *    against WCAG 2.1 AA ratios).
 *
 *  - Page-structure rules (`region`, `landmark-one-main`, `page-has-heading-one`,
 *    `document-title`, `html-has-lang`, `bypass`): these audit a full document,
 *    but here we mount individual components in isolation. They are enforced at
 *    the page level by the live app shell, not by leaf/container components.
 */
import { expect } from 'vitest'
import { axe } from 'vitest-axe'
import * as matchers from 'vitest-axe/matchers'
import 'vitest-axe/extend-expect'

expect.extend(matchers)

const COMPONENT_DISABLED_RULES = [
  'color-contrast',
  'region',
  'landmark-one-main',
  'page-has-heading-one',
  'document-title',
  'html-has-lang',
  'bypass',
] as const

/**
 * Run axe against a mounted component element, with rules that require full-page
 * context or real rendering disabled. Use for component-level a11y assertions.
 */
export function runComponentAxe(element: Element) {
  return axe(element, {
    rules: Object.fromEntries(
      COMPONENT_DISABLED_RULES.map((id) => [id, { enabled: false }])
    ),
  })
}
