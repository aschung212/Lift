/**
 * Regression test for LIFT-636: Vercel Analytics and Speed Insights must be
 * deferred to after first paint via requestIdleCallback / setTimeout, not
 * called synchronously in main.ts.  This prevents analytics from competing
 * with the critical rendering path.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const mainSrc = readFileSync(resolve(__dirname, '../main.ts'), 'utf-8')

describe('analytics deferral (LIFT-636)', () => {
  it('wraps analytics calls in requestIdleCallback or setTimeout', () => {
    expect(mainSrc).toMatch(/requestIdleCallback/)
    expect(mainSrc).toMatch(/setTimeout/)
  })

  it('calls inject() and injectSpeedInsights() inside the deferred callback', () => {
    // Both calls should appear inside the deferAfterPaint callback block
    const deferBlock = mainSrc.match(/deferAfterPaint\(\(\)\s*=>\s*\{([\s\S]*?)\}\)/)
    expect(deferBlock).not.toBeNull()
    expect(deferBlock![1]).toContain('inject()')
    expect(deferBlock![1]).toContain('injectSpeedInsights()')
  })

  it('does not call inject() or injectSpeedInsights() outside the deferred block', () => {
    // Remove the deferred block, then check no standalone calls remain
    const withoutDeferBlock = mainSrc.replace(
      /deferAfterPaint\(\(\)\s*=>\s*\{[\s\S]*?\}\)/,
      '',
    )
    // Should not find bare inject() calls (import statements are fine)
    const hasBareSyncInject = /(?<!import .*)(?<!\w)inject\(\)/.test(withoutDeferBlock)
    const hasBareSyncSpeedInsights = /(?<!\w)injectSpeedInsights\(\)/.test(withoutDeferBlock)
    expect(hasBareSyncInject).toBe(false)
    expect(hasBareSyncSpeedInsights).toBe(false)
  })
})
