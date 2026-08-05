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

// ── IntersectionObserver mock ─────────────────────────────────────
// happy-dom ships no IntersectionObserver. Components use it to detect when an
// element actually scrolls into view (e.g. SettingsSheet's supporter-funnel
// impression, LIFT-906). This controllable stub records every live observer in
// `mockIntersectionObservers` so a test can fire an intersection deliberately
// via `instance.trigger(isIntersecting)` rather than guessing at real layout.
class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  elements = new Set<Element>()
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb
    mockIntersectionObservers.push(this)
  }
  observe(el: Element): void { this.elements.add(el) }
  unobserve(el: Element): void { this.elements.delete(el) }
  disconnect(): void { this.elements.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  /** Test helper — fire the callback for every currently-observed target. */
  trigger(isIntersecting = true): void {
    const entries = [...this.elements].map(
      (target) => ({ isIntersecting, target } as IntersectionObserverEntry),
    )
    if (entries.length) this.callback(entries, this as unknown as IntersectionObserver)
  }
}
export const mockIntersectionObservers: MockIntersectionObserver[] = []
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

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
afterEach(() => {
  localStorage.clear?.()
  mockIntersectionObservers.length = 0
  vi.clearAllMocks()
})
