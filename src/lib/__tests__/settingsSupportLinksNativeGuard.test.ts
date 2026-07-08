/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression test for LIFT-909.
 *
 * App Store guideline 3.1.1 prohibits steering users to external payment
 * mechanisms on the native (Capacitor) build. Both external support links
 * (GitHub Sponsors, Buy Me a Coffee) in the Settings "Support" group MUST be
 * guarded by `v-if="!isNative"` so they never render inside the iOS shell.
 *
 * This is a structural source check (not a full mount) to keep it cheap and
 * to pin the exact guard that keeps us compliant.
 */
const source = readFileSync(
  resolve(__dirname, '../../components/SettingsSheet.vue'),
  'utf-8',
)

// Grab the opening <a ...> tag for a given external URL.
function anchorTagFor(url: string): string {
  const idx = source.indexOf(url)
  expect(idx, `expected to find external support link ${url}`).toBeGreaterThan(-1)
  const open = source.lastIndexOf('<a', idx)
  const close = source.indexOf('>', idx)
  expect(open).toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return source.slice(open, close + 1)
}

describe('LIFT-909: external support links hidden on native', () => {
  const externalSupportUrls = [
    'https://github.com/sponsors/aschung212',
    'https://buymeacoffee.com/aschung212',
  ]

  it.each(externalSupportUrls)(
    'guards %s with v-if="!isNative"',
    (url) => {
      expect(anchorTagFor(url)).toContain('v-if="!isNative"')
    },
  )

  it('imports isNative from the platform helper', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bisNative\b[^}]*\}\s*from\s*['"]\.\.\/lib\/platform['"]/)
  })
})
