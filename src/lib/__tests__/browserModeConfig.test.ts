import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8')

const browserConfig = read('vitest.browser.config.js')
const defaultConfig = read('vitest.config.js')
const pkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

// Guardrail for the opt-in Vitest Browser Mode suite (LIFT-666). These assert
// the two configs stay non-overlapping and the on-demand wiring survives edits,
// so a browser test never silently runs (or fails to run) in the wrong env.
describe('Vitest Browser Mode config (LIFT-666)', () => {
  it('enables a real Chromium via the Playwright provider', () => {
    expect(browserConfig).toContain('enabled: true')
    expect(browserConfig).toContain("provider: 'playwright'")
    expect(browserConfig).toContain("browser: 'chromium'")
  })

  it('scopes the browser suite to *.browser.test.ts only', () => {
    expect(browserConfig).toContain("include: ['src/**/*.browser.test.ts']")
  })

  it('excludes browser tests from the default happy-dom run so none runs twice', () => {
    expect(defaultConfig).toContain("'**/*.browser.test.ts'")
    // The default config must NOT enable browser mode.
    expect(defaultConfig).not.toContain("provider: 'playwright'")
  })

  it('exposes an on-demand test:browser script pointed at the browser config', () => {
    expect(pkg.scripts['test:browser']).toBe(
      'vitest run --config vitest.browser.config.js'
    )
  })

  it('keeps @vitest/browser and playwright out of the committed lockfile (like lhci)', () => {
    // They pull Chromium + a large tree that would bloat the lockfile and the
    // dependency-review gate for a tool that only runs on demand. Installed
    // ad hoc to run locally — see docs/browser-mode-testing.md.
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(all['@vitest/browser']).toBeUndefined()
    expect(all['playwright']).toBeUndefined()
  })

  it('ships at least one browser-mode test to run', () => {
    expect(
      existsSync(
        resolve(root, 'src/composables/__tests__/useSwipeToDismiss.browser.test.ts')
      )
    ).toBe(true)
  })
})
