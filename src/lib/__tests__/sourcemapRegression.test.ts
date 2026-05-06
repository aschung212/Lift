/**
 * Regression test for LIFT-341: source maps must never be generated
 * unconditionally. They should only be built when Sentry is configured
 * (SENTRY_AUTH_TOKEN is set), because the Sentry plugin uploads them
 * and then deletes them from the build output.
 *
 * Generating source maps without Sentry means they ship to production,
 * exposing the full source code to anyone who requests .map files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('vite.config.js sourcemap setting (LIFT-341)', () => {
  const configPath = resolve(__dirname, '../../../vite.config.js')
  const configSource = readFileSync(configPath, 'utf8')

  it('does not unconditionally enable sourcemaps', () => {
    // sourcemap: true would generate maps even without Sentry
    expect(configSource).not.toMatch(/sourcemap:\s*true/)
  })

  it('gates sourcemap generation on SENTRY_AUTH_TOKEN', () => {
    expect(configSource).toMatch(/sourcemap:.*SENTRY_AUTH_TOKEN/)
  })
})
