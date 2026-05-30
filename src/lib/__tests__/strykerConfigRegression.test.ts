import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '../../../')

const strykerConfig = JSON.parse(
  readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'),
)

const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf-8'),
)

// Mutation testing (LIFT-667) validates assertion *strength*, not just line
// coverage: Stryker mutates source (flips conditionals, swaps operators, strips
// returns) and reports which mutants the suite fails to kill. The config is
// scoped to a narrow set of deterministic, DOM-free pure-logic files so a full
// run stays fast and on-demand (it is intentionally NOT wired into CI). These
// tests guard the wiring so the config can't silently rot — e.g. a mutate
// target being renamed/deleted, or the runner being pointed at a missing
// vitest config — which would make `npm run test:mutation` fail at the worst
// possible time (when someone finally reaches for it).
describe('stryker.config.json regression', () => {
  it('uses the vitest test runner', () => {
    expect(strykerConfig.testRunner).toBe('vitest')
  })

  it('points the vitest runner at the real, existing vitest config', () => {
    const configFile = strykerConfig.vitest?.configFile
    expect(configFile).toBeTruthy()
    expect(existsSync(resolve(root, configFile))).toBe(true)
  })

  it('mutates a non-empty, scoped set of source files', () => {
    expect(Array.isArray(strykerConfig.mutate)).toBe(true)
    expect(strykerConfig.mutate.length).toBeGreaterThan(0)
    // Keep the scope tight — mutation runs are slow, and the value is in
    // high-signal pure logic, not the whole tree.
    expect(strykerConfig.mutate.length).toBeLessThanOrEqual(12)
  })

  it('only points at source files that still exist (no config rot)', () => {
    for (const target of strykerConfig.mutate) {
      expect(
        existsSync(resolve(root, target)),
        `stryker mutate target "${target}" does not exist — update stryker.config.json`,
      ).toBe(true)
    }
  })

  it('mutates only DOM-free pure-logic lib files', () => {
    for (const target of strykerConfig.mutate) {
      expect(target.startsWith('src/lib/')).toBe(true)
      expect(target.endsWith('.ts')).toBe(true)
    }
  })

  it('declares a break threshold so a regression in assertion quality fails the run', () => {
    expect(typeof strykerConfig.thresholds?.break).toBe('number')
    expect(strykerConfig.thresholds.break).toBeGreaterThan(0)
  })

  it('exposes a test:mutation script wired to stryker', () => {
    expect(packageJson.scripts['test:mutation']).toBe('stryker run')
  })

  it('declares the stryker core + vitest-runner dev dependencies', () => {
    expect(packageJson.devDependencies['@stryker-mutator/core']).toBeTruthy()
    expect(
      packageJson.devDependencies['@stryker-mutator/vitest-runner'],
    ).toBeTruthy()
  })
})
