import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const capacitorConfig = readFileSync(
  resolve(__dirname, '../../../capacitor.config.ts'),
  'utf-8',
)

// The native iOS/Android bundle identifier is an external identifier that must
// never drift or be fabricated (see the SEV1 "never fabricate identifiers" rule
// in CLAUDE.md). `com.aschung212.lift` is a deliberate decision from #216 and is
// the identity the App Store build will ship under — changing it silently would
// orphan an installed app's data and break Capacitor plugin allow-lists.
describe('capacitor.config.ts regression', () => {
  it('pins the iOS/Android appId to the deliberate com.aschung212.lift bundle id', () => {
    expect(capacitorConfig).toContain("appId: 'com.aschung212.lift'")
    // The old placeholder id must never come back.
    expect(capacitorConfig).not.toContain('app.lift.tracker')
  })

  it('keeps appName as Lift and webDir pointing at the Vite dist bundle', () => {
    expect(capacitorConfig).toContain("appName: 'Lift'")
    expect(capacitorConfig).toContain("webDir: 'dist'")
  })

  it('keeps the iOS custom scheme so deep links and StatusBar config resolve', () => {
    expect(capacitorConfig).toContain("scheme: 'Lift'")
  })
})
