/**
 * Global test setup — runs before each test file.
 * Provides universal mocks that nearly every test needs.
 */
import { vi, afterEach } from 'vitest'

// ── localStorage mock ────────────────────────────────────────────
// Identical localStorage mock was duplicated across 10+ test files.
// Centralizing it here ensures consistent behavior and reduces boilerplate.
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = String(val) }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

// ── Supabase mock ────────────────────────────────────────────────
// Most tests need supabase stubbed to null (local-first architecture).
vi.mock('../lib/supabase', () => ({ supabase: null }))

// ── Global teardown ──────────────────────────────────────────────
// Make test isolation the default instead of relying on every one of the
// 100+ test files to remember to clear storage and mock call history in its
// own beforeEach. Any file that forgets used to silently inherit the previous
// test's localStorage entries and accumulated mock.calls counts, producing
// order-dependent flakes. clearAllMocks() only resets recorded calls/results —
// it leaves mockReturnValue/spy implementations intact — so per-file setup is
// unaffected. `clear?.()` tolerates the occasional file that swaps in its own
// localStorage stub without a clear() method (e.g. migrate.test.ts); those
// files reset their own store in beforeEach, so nothing leaks.
//
// useRealTimers() closes the one leak class clearAllMocks() can't: 21 files
// call vi.useFakeTimers() (all in beforeEach), but a file that forgets the
// matching vi.useRealTimers() leaves fake timers armed for whatever runs next
// — real setTimeout/Date.now() then silently freeze. Restoring here makes the
// teardown self-sufficient regardless of per-file discipline; it's a harmless
// no-op when timers were never faked, and because every fake-timer file arms
// them per-test in beforeEach, resetting between tests never strands a suite.
afterEach(() => {
  localStorage.clear?.()
  vi.useRealTimers()
  vi.clearAllMocks()
})
