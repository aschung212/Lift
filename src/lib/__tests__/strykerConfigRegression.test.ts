import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '../../../')
const strykerConfig = JSON.parse(readFileSync(resolve(root, 'stryker.config.json'), 'utf-8'))
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))

// Mutation testing (LIFT-667) validates ASSERTION quality, not execution: it
// mutates src/lib/ logic and checks the suite would fail. These tests pin the
// config's intent so the scope can't silently rot or the tool creep into the
// lockfile.
describe('stryker.config.json regression', () => {
  it('drives mutation runs through the real Vitest suite', () => {
    expect(strykerConfig.testRunner).toBe('vitest')
    expect(strykerConfig.vitest.configFile).toBe('vitest.config.js')
  })

  it('uses per-test coverage analysis so only covering tests run per mutant', () => {
    // "perTest" maps each mutant to the tests that exercise it — the difference
    // between a tractable run and re-running the whole ~2900-test suite per mutant.
    expect(strykerConfig.coverageAnalysis).toBe('perTest')
  })

  it('scopes mutation ONLY to deterministic pure logic in src/lib/', () => {
    // The value is concentrated in pure, high-consequence math (1RM estimation,
    // conflict resolution, warmup classification, intensity/plate/scoring). Keeping
    // the scope tight keeps runs fast and the mutation score meaningful. Do NOT
    // broaden this to components/stores without intent — that reintroduces the
    // flaky, layout/time-dependent surface mutation testing is a poor fit for.
    expect(Array.isArray(strykerConfig.mutate)).toBe(true)
    expect(strykerConfig.mutate.length).toBeGreaterThan(0)
    for (const glob of strykerConfig.mutate) {
      expect(glob.startsWith('src/lib/')).toBe(true)
    }
  })

  it('targets files that actually exist (a rename must not silently orphan the scope)', () => {
    for (const glob of strykerConfig.mutate) {
      expect(existsSync(resolve(root, glob)), `${glob} is missing`).toBe(true)
    }
  })

  it('exposes the run via an npm script using a pinned npx invocation', () => {
    // Mirrors the lhci pattern in ci.yml: heavyweight, CI-optional tooling runs
    // through pinned npx rather than a committed dependency.
    expect(packageJson.scripts['test:mutation']).toBeDefined()
    expect(packageJson.scripts['test:mutation']).toContain('@stryker-mutator/core')
    expect(packageJson.scripts['test:mutation']).toContain('@stryker-mutator/vitest-runner')
    expect(packageJson.scripts['test:mutation']).toContain('stryker run')
  })

  it('does NOT add Stryker to the lockfile (avoids bloat + dependency-review gate)', () => {
    // Stryker drags in a large transitive tree and never runs in PR CI, so — like
    // @lhci/cli — it stays out of package.json deps and is fetched on demand.
    const allDeps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    }
    for (const name of Object.keys(allDeps)) {
      expect(name.startsWith('@stryker-mutator/')).toBe(false)
    }
  })
})
