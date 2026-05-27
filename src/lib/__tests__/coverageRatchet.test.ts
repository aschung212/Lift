import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const BASELINE_PATH = resolve(ROOT, '.coverage-baseline.json')
const SCRIPT_PATH = resolve(ROOT, 'scripts/check-coverage-ratchet.js')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')
const FILE_METRICS = ['statements', 'branches', 'functions', 'lines'] as const

// Import pure logic from the ratchet module for unit testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let compareBaseline: any, formatResults: any, METRICS: any
beforeAll(async () => {
  const mod = await import('../../../scripts/coverage-ratchet.js')
  compareBaseline = mod.compareBaseline
  formatResults = mod.formatResults
  METRICS = mod.METRICS
})

/** Helper: create a coverage-summary.json structure from metric values */
function makeSummary(values: { statements: number; branches: number; functions: number; lines: number }) {
  return {
    total: {
      statements: { pct: values.statements },
      branches: { pct: values.branches },
      functions: { pct: values.functions },
      lines: { pct: values.lines },
    },
  }
}

const baseline = { statements: 70, branches: 55, functions: 60, lines: 72 }

describe('coverage ratchet — structural', () => {
  it('baseline file exists and is valid JSON', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true)
    const bl = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    for (const metric of FILE_METRICS) {
      expect(bl).toHaveProperty(metric)
      expect(typeof bl[metric]).toBe('number')
      expect(bl[metric]).toBeGreaterThanOrEqual(0)
      expect(bl[metric]).toBeLessThanOrEqual(100)
    }
  })

  it('baseline thresholds are at least as high as vitest static thresholds', () => {
    const bl = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    // Static thresholds from vitest.config.js — the ratchet should always be >= these
    const staticThresholds = { statements: 60, branches: 50, functions: 55, lines: 60 }
    for (const metric of FILE_METRICS) {
      expect(bl[metric]).toBeGreaterThanOrEqual(
        staticThresholds[metric],
        `Baseline ${metric} (${bl[metric]}%) is below the static threshold (${staticThresholds[metric]}%)`
      )
    }
  })

  it('ratchet script exists', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true)
  })

  it('ratchet logic module exists', () => {
    expect(existsSync(resolve(ROOT, 'scripts/coverage-ratchet.js'))).toBe(true)
  })

  it('CI workflow runs the ratchet check after coverage', () => {
    const ci = readFileSync(CI_PATH, 'utf8')
    expect(ci).toContain('node scripts/check-coverage-ratchet.js')
    // Ratchet step should come after vitest coverage
    const coverageIdx = ci.indexOf('npx vitest run --coverage')
    const ratchetIdx = ci.indexOf('node scripts/check-coverage-ratchet.js')
    expect(ratchetIdx).toBeGreaterThan(coverageIdx)
  })

  it('CI workflow auto-ratchets on master push', () => {
    const ci = readFileSync(CI_PATH, 'utf8')
    expect(ci).toContain('check-coverage-ratchet.js --update')
  })
})

describe('coverage ratchet — compareBaseline', () => {
  it('exports the four standard coverage metrics', () => {
    expect(METRICS).toEqual(['statements', 'branches', 'functions', 'lines'])
  })

  it('passes when coverage matches baseline exactly', () => {
    const summary = makeSummary(baseline)
    const result = compareBaseline(summary, baseline)

    expect(result.failed).toBe(false)
    expect(result.updatedBaseline).toBeNull()
    for (const r of result.results) {
      expect(r.delta).toBe(0)
      expect(r.regressed).toBe(false)
      expect(r.improved).toBe(false)
    }
  })

  it('passes when coverage improves', () => {
    const summary = makeSummary({ statements: 75, branches: 60, functions: 65, lines: 78 })
    const result = compareBaseline(summary, baseline)

    expect(result.failed).toBe(false)
    for (const r of result.results) {
      expect(r.delta).toBeGreaterThan(0)
      expect(r.improved).toBe(true)
    }
  })

  it('fails when any metric drops below baseline (margin=0)', () => {
    const summary = makeSummary({ statements: 69, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { margin: 0 })

    expect(result.failed).toBe(true)
    const stmts = result.results.find((r: { metric: string }) => r.metric === 'statements')
    expect(stmts.regressed).toBe(true)
    expect(stmts.delta).toBe(-1)
  })

  it('allows drops within the configured margin', () => {
    const summary = makeSummary({ statements: 69, branches: 54, functions: 59, lines: 71 })
    const result = compareBaseline(summary, baseline, { margin: 2 })

    expect(result.failed).toBe(false)
    for (const r of result.results) {
      expect(r.regressed).toBe(false)
    }
  })

  it('fails when drop exceeds the configured margin', () => {
    const summary = makeSummary({ statements: 67, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { margin: 2 })

    expect(result.failed).toBe(true)
    const stmts = result.results.find((r: { metric: string }) => r.metric === 'statements')
    expect(stmts.regressed).toBe(true)
    expect(stmts.delta).toBe(-3)
  })

  it('does not produce updatedBaseline without update flag', () => {
    const summary = makeSummary({ statements: 75, branches: 60, functions: 65, lines: 78 })
    const result = compareBaseline(summary, baseline, { update: false })

    expect(result.updatedBaseline).toBeNull()
  })

  it('produces updatedBaseline with update flag when coverage improves', () => {
    const summary = makeSummary({ statements: 75, branches: 60, functions: 65, lines: 78 })
    const result = compareBaseline(summary, baseline, { update: true })

    expect(result.updatedBaseline).toEqual({ statements: 75, branches: 60, functions: 65, lines: 78 })
  })

  it('only ratchets up metrics that actually improved', () => {
    const summary = makeSummary({ statements: 75, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { update: true })

    expect(result.updatedBaseline).toEqual({
      statements: 75,  // improved
      branches: 55,    // unchanged
      functions: 60,   // unchanged
      lines: 72,       // unchanged
    })
  })

  it('rounds updated values to 2 decimal places', () => {
    const summary = makeSummary({ statements: 70.126, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { update: true })

    expect(result.updatedBaseline).not.toBeNull()
    expect(result.updatedBaseline.statements).toBe(70.13)
  })

  it('does not produce updatedBaseline when no metrics improved', () => {
    const summary = makeSummary({ statements: 70, branches: 54, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { update: true })

    expect(result.updatedBaseline).toBeNull()
  })

  it('can both fail and detect improvements simultaneously', () => {
    // statements dropped (fail), but branches improved
    const summary = makeSummary({ statements: 69, branches: 60, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { margin: 0, update: true })

    expect(result.failed).toBe(true)
    const branches = result.results.find((r: { metric: string }) => r.metric === 'branches')
    expect(branches.improved).toBe(true)
  })
})

describe('coverage ratchet — formatResults', () => {
  it('includes REGRESSION marker for failed metrics', () => {
    const summary = makeSummary({ statements: 69, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { margin: 0 })
    const output = formatResults(result, { margin: 0 })

    expect(output).toContain('✗ REGRESSION')
    expect(output).toContain('Add tests to restore coverage before merging')
  })

  it('includes improved marker for improved metrics', () => {
    const summary = makeSummary({ statements: 75, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline)
    const output = formatResults(result, { margin: 0 })

    expect(output).toContain('↑ improved')
  })

  it('shows ratchet message when baseline was updated', () => {
    const summary = makeSummary({ statements: 75, branches: 60, functions: 65, lines: 78 })
    const result = compareBaseline(summary, baseline, { update: true })
    const output = formatResults(result, { margin: 0 })

    expect(output).toContain('Baseline ratcheted up')
  })

  it('shows no-change message when coverage matches exactly', () => {
    const summary = makeSummary(baseline)
    const result = compareBaseline(summary, baseline)
    const output = formatResults(result, { margin: 0 })

    expect(output).toContain('Coverage matches baseline. No changes needed.')
  })

  it('shows run-with-update hint when improved but not updating', () => {
    const summary = makeSummary({ statements: 75, branches: 55, functions: 60, lines: 72 })
    const result = compareBaseline(summary, baseline, { update: false })
    const output = formatResults(result, { margin: 0 })

    expect(output).toContain('Run with --update to ratchet up the baseline')
  })

  it('displays the configured margin', () => {
    const summary = makeSummary(baseline)
    const result = compareBaseline(summary, baseline, { margin: 2 })
    const output = formatResults(result, { margin: 2 })

    expect(output).toContain('Margin: 2%')
  })
})
