/**
 * Null-safety contract for the shared global teardown in `setup.ts`.
 *
 * `setup.ts`'s afterEach cleared storage via `localStorage.clear?.()`. That
 * optional call guards a localStorage stub that lacks a `clear` METHOD, but not
 * the absence of the `localStorage` GLOBAL — and `composableSSRSafety.test.ts`
 * deliberately creates exactly that state (`vi.stubGlobal('localStorage',
 * undefined)`) to prove the settings composables import cleanly under SSR. It
 * restores the real global in a `finally`, so the two coexist in the common
 * case; but if that test is interrupted before its `finally` runs — a slow
 * dynamic `import()` timing out under a loaded CI box — the global stays
 * `undefined` and the shared teardown throws
 * `TypeError: Cannot read properties of undefined (reading 'clear')`.
 *
 * That surfaced as all three SSR-safety tests failing at `setup.ts:65` in a
 * full-suite run while passing in isolation: an order- and load-dependent flake
 * whose reported location is the shared teardown rather than anything the
 * failing file did. Since the teardown runs after EVERY test in the suite, the
 * hole is reachable by any future test that legitimately removes the global.
 *
 * This pins the contract: teardown must no-op when there is no `localStorage`,
 * exactly as it already no-ops when there is no `clear`. The test leaves the
 * global stubbed to `undefined` ON PURPOSE — the shared afterEach runs while it
 * is missing, so this file fails if the guard regresses.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'

describe('global test teardown is null-safe (setup.ts)', () => {
  // Restore the real globals for any later file sharing this worker.
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('tolerates localStorage being absent entirely (SSR-style stub)', () => {
    vi.stubGlobal('localStorage', undefined)

    // The assertion that matters runs *after* this test: the shared afterEach
    // in setup.ts fires with no localStorage global. If it dereferences it
    // unguarded, this test file fails in teardown.
    expect(globalThis.localStorage).toBeUndefined()
  })

  it('tolerates a localStorage stub with no clear() method', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })

    expect(globalThis.localStorage.clear).toBeUndefined()
  })
})
