/**
 * SSR / import-safety contract for the settings-accessor composables (LIFT-1180).
 *
 * Before LIFT-821, useWeightUnit read `localStorage.getItem('weight-unit')` at
 * module top-level — executed on import, before any component or test setup. That
 * threw under SSR (no `localStorage` global) and forced jsdom just to import the
 * module. LIFT-821 removed the module-scope read: these composables are now thin
 * writable-computed accessors bound to the preferences store, and they touch
 * localStorage only lazily through the store (whose reads are try/catch guarded).
 *
 * These tests pin that contract structurally: importing each composable module
 * must NOT require a `localStorage` global to exist. If a future refactor
 * reintroduces a top-level `localStorage.getItem` / `JSON.parse(localStorage…)`
 * in any of these files (or anywhere in their import graph), the SSR import will
 * throw "Cannot read properties of undefined" and fail here — catching the exact
 * regression the store-side `workoutStorageHydration.test.ts` guards for the
 * workout store's secondary-state hydration.
 */
import { describe, it, expect, vi } from 'vitest'

/**
 * Import a module with the `localStorage` global removed (SSR conditions) and
 * assert the import resolves without throwing. Restores the real mock afterward
 * so the shared global from `setup.ts` survives for later tests in the file.
 */
async function expectImportsWithoutLocalStorage(specifier: string): Promise<unknown> {
  const realLocalStorage = globalThis.localStorage
  vi.stubGlobal('localStorage', undefined)
  vi.resetModules()
  try {
    return await import(/* @vite-ignore */ specifier)
  } finally {
    vi.stubGlobal('localStorage', realLocalStorage)
    vi.resetModules()
  }
}

describe('settings-accessor composables are SSR/import-safe (LIFT-1180)', () => {
  it('imports useWeightUnit without a localStorage global', async () => {
    const mod = await expectImportsWithoutLocalStorage('../useWeightUnit')
    expect(mod).toHaveProperty('useWeightUnit')
  })

  it('imports useRestTimer without a localStorage global', async () => {
    const mod = await expectImportsWithoutLocalStorage('../useRestTimer')
    expect(mod).toHaveProperty('useRestTimer')
  })

  it('imports useTheme without a localStorage global', async () => {
    // useTheme reads localStorage only inside initTheme() (guarded by isBrowser),
    // never at module scope — so importing it under SSR must not throw either.
    const mod = await expectImportsWithoutLocalStorage('../useTheme')
    expect(mod).toHaveProperty('useTheme')
    expect(mod).toHaveProperty('initTheme')
  })
})
