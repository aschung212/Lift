/**
 * Shared test utilities for Lift.
 *
 * Provides reusable mock factories and mount helpers to reduce
 * boilerplate across component and store tests.
 */
import { vi } from 'vitest'
import { ref } from 'vue'

// ── localStorage helpers ─────────────────────────────────────────

/** Type-safe access to the global localStorage mock from setup.ts */
export function getLocalStorageMock() {
  return localStorage as unknown as {
    getItem: (...args: unknown[]) => string | null
    setItem: (...args: unknown[]) => void
    removeItem: (...args: unknown[]) => void
    clear: () => void
  } & Record<string, ReturnType<typeof vi.fn>>
}

// ── Mock factories ───────────────────────────────────────────────

/** Default useAnalytics mock — all methods are vi.fn() no-ops. */
export function mockAnalytics() {
  return {
    useAnalytics: () => ({
      logEvent: vi.fn(),
      tabSwitch: vi.fn(),
      flushEngagement: vi.fn(),
    })
  }
}

/** Default useTheme mock — lbs, no rest timer. */
export function mockTheme(overrides: Record<string, unknown> = {}) {
  return {
    useTheme: () => ({
      weightUnit: ref('lbs'),
      displayWeight: (w: number) => Math.round(w),
      toLbs: (w: number) => w,
      restTimerEnabled: ref(false),
      currentTheme: ref('eternal'),
      THEMES: [],
      THEME_PREVIEWS: {},
      colorMode: ref('dark'),
      resolvedMode: ref('dark'),
      glassEnabled: ref(true),
      ...overrides,
    })
  }
}

/** Default useAuth mock — all methods resolve successfully. */
export function mockAuth() {
  return {
    useAuth: () => ({
      signInWithProvider: vi.fn().mockResolvedValue({ error: null }),
      signInWithEmail: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
    })
  }
}
