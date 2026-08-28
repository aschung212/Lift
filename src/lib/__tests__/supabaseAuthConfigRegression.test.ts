import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const authConfig = readFileSync(
  resolve(__dirname, '../../../supabase/config.toml'),
  'utf-8',
)

// supabase/config.toml is committed and pushed to production via `supabase config
// push`, so it IS the intended production auth posture — not just local-dev
// scaffolding. These assertions pin the hardened password policy from LIFT-1124
// so a future config edit can't silently regress it back below Supabase's own
// recommended floor (and below iOS App Store account-security expectations).
describe('supabase/config.toml auth password policy regression', () => {
  const uncommented = (key: string): string | undefined => {
    // Match the first non-commented `key = value` line for the given key.
    const match = authConfig.match(
      new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'),
    )
    return match?.[1]?.trim()
  }

  it('requires at least 8-character passwords (Supabase-recommended floor)', () => {
    const value = uncommented('minimum_password_length')
    expect(value).toBeDefined()
    const length = Number(value)
    expect(Number.isInteger(length)).toBe(true)
    expect(length).toBeGreaterThanOrEqual(8)
  })

  it('enforces mixed-case-and-digit password complexity', () => {
    expect(uncommented('password_requirements')).toBe(
      '"lower_upper_letters_digits"',
    )
  })

  it('never regresses password_requirements back to the empty (no-op) policy', () => {
    expect(uncommented('password_requirements')).not.toBe('""')
  })
})
