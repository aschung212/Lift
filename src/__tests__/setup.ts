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

// ── Blob-aware structuredClone (for fake-indexeddb round-trips) ───
// fake-indexeddb clones every value on insert via the global `structuredClone`
// (per the IndexedDB "clone value" step). happy-dom's Blob keeps its bytes on a
// symbol-keyed Buffer that Node's native structuredClone silently drops, so a
// stored photo blob would come back as a byteless plain object with no `.text()`
// (`blob.text is not a function`) — breaking the progress-photos IndexedDB layer
// in tests only (real WebKit/WKWebView clones Blobs faithfully). Preserve Blob
// (and File, which extends it) leaves — they're immutable, so sharing the
// instance is safe — and delegate every other value to the native clone so
// Dates, Maps, and typed arrays still survive. Assigned directly (not via
// vi.stubGlobal) so a test file's own vi.unstubAllGlobals() can't wipe it
// between cases.
const nativeStructuredClone = globalThis.structuredClone.bind(globalThis)
function blobAwareStructuredClone<T>(value: T): T {
  if (value instanceof Blob) return value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(blobAwareStructuredClone) as unknown as T
  // Only hand-recurse plain records so nested Blobs survive; hand anything else
  // (Date, Map, Set, TypedArray, …) to the native clone for a faithful copy.
  const proto = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === null) {
    const out: Record<string | symbol, unknown> = {}
    for (const key of Reflect.ownKeys(value as object)) {
      out[key] = blobAwareStructuredClone((value as Record<string | symbol, unknown>)[key])
    }
    return out as T
  }
  return nativeStructuredClone(value)
}
globalThis.structuredClone = blobAwareStructuredClone

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
