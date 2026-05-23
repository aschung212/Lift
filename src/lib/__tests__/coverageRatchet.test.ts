import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const BASELINE_PATH = resolve(ROOT, '.coverage-baseline.json')
const SCRIPT_PATH = resolve(ROOT, 'scripts/check-coverage-ratchet.js')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')
const METRICS = ['statements', 'branches', 'functions', 'lines'] as const

describe('coverage ratchet', () => {
  it('baseline file exists and is valid JSON', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true)
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    for (const metric of METRICS) {
      expect(baseline).toHaveProperty(metric)
      expect(typeof baseline[metric]).toBe('number')
      expect(baseline[metric]).toBeGreaterThanOrEqual(0)
      expect(baseline[metric]).toBeLessThanOrEqual(100)
    }
  })

  it('baseline thresholds are at least as high as vitest static thresholds', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    // Static thresholds from vitest.config.js — the ratchet should always be >= these
    const staticThresholds = { statements: 60, branches: 50, functions: 55, lines: 60 }
    for (const metric of METRICS) {
      expect(baseline[metric]).toBeGreaterThanOrEqual(
        staticThresholds[metric],
        `Baseline ${metric} (${baseline[metric]}%) is below the static threshold (${staticThresholds[metric]}%)`
      )
    }
  })

  it('ratchet script exists', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true)
  })

  it('CI workflow runs the ratchet check after coverage', () => {
    const ci = readFileSync(CI_PATH, 'utf8')
    expect(ci).toContain('node scripts/check-coverage-ratchet.js')
    // Ratchet step should come after vitest coverage
    const coverageIdx = ci.indexOf('npx vitest run --coverage')
    const ratchetIdx = ci.indexOf('node scripts/check-coverage-ratchet.js')
    expect(ratchetIdx).toBeGreaterThan(coverageIdx)
  })
})
