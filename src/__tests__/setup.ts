/**
 * Global test setup — runs before each test file.
 * Provides universal mocks that nearly every test needs.
 */
import { vi } from 'vitest'

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
