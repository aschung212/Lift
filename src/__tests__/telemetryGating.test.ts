/**
 * Regression test for LIFT-533: Capacitor-aware telemetry gating + Sentry PII
 * scrubbing.
 *
 * - Vercel Analytics + Speed Insights must NOT fire on the native iOS Capacitor
 *   build (keeps the App Store privacy story simple — no analytics network calls
 *   on device). They stay enabled on the web build.
 * - Sentry must scrub PII consistently: sendDefaultPii disabled, IP address
 *   stripped in beforeSend, and releases tagged so web crashes are
 *   distinguishable from iOS crashes.
 *
 * main.ts mounts the app as an import side effect, so we scan the source rather
 * than execute it — the same approach as analyticsDeferral.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const mainSrc = readFileSync(resolve(__dirname, '../main.ts'), 'utf-8')

describe('telemetry gating + PII scrubbing (LIFT-533)', () => {
  it('imports the native-platform flag', () => {
    expect(mainSrc).toMatch(/import\s*\{\s*isNative\s*\}\s*from\s*['"]\.\/lib\/platform['"]/)
  })

  it('gates Vercel Analytics + Speed Insights behind a native-platform check', () => {
    // The inject() / injectSpeedInsights() calls must sit inside an `if (!isNative)`
    // block so they never run on the iOS Capacitor build.
    const gateBlock = mainSrc.match(/if\s*\(\s*!isNative\s*\)\s*\{([\s\S]*?)\}/)
    expect(gateBlock).not.toBeNull()
    expect(gateBlock![1]).toContain('inject()')
    expect(gateBlock![1]).toContain('injectSpeedInsights()')
  })

  it('disables Sentry default PII collection', () => {
    expect(mainSrc).toMatch(/sendDefaultPii:\s*false/)
  })

  it('scrubs the IP address in Sentry beforeSend', () => {
    expect(mainSrc).toMatch(/delete\s+event\.user\.ip_address/)
  })

  it('tags Sentry releases to distinguish web from iOS builds', () => {
    // release: `${isNative ? 'ios' : 'web'}@${__APP_VERSION__}`
    expect(mainSrc).toMatch(/release:\s*`\$\{isNative\s*\?\s*'ios'\s*:\s*'web'\}@\$\{__APP_VERSION__\}`/)
  })
})
