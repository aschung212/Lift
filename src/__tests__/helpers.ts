/**
 * Shared test utilities for Lift.
 *
 * Provides reusable mock factories and mount helpers to reduce
 * boilerplate across component and store tests.
 */
import { vi } from 'vitest'
import { ref } from 'vue'
import { epley } from '../lib/epley'
import type { Exercise, WorkoutSet } from '../stores/workout'

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

/** Default useTheme mock — lbs, no rest timer. Glass is always on as of the 2026 refresh. */
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
      ...overrides,
    })
  }
}

/** Default useWeightUnit mock — lbs, identity conversion. */
export function mockWeightUnit(overrides: Record<string, unknown> = {}) {
  return {
    useWeightUnit: () => ({
      weightUnit: ref('lbs'),
      displayWeight: (w: number) => Math.round(w),
      toLbs: (w: number) => w,
      ...overrides,
    })
  }
}

/** Default useRestTimer mock — disabled. */
export function mockRestTimer(overrides: Record<string, unknown> = {}) {
  return {
    useRestTimer: () => ({
      restTimerEnabled: ref(false),
      restTimerAutoStart: ref(false),
      setRestTimerEnabled: vi.fn(),
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

// ── Fixture factories ────────────────────────────────────────────

/**
 * Build a WorkoutSet with sensible defaults. `weight` and `reps` are
 * required; `estimated1RM` is auto-computed via `epley()` unless
 * overridden. Used across progression, xp, theme-stats, and migration
 * tests so the fixture shape stays in lockstep with the production
 * WorkoutSet type.
 */
export function makeSet(overrides: Partial<WorkoutSet> & { weight: number; reps: number }): WorkoutSet {
  const { weight, reps } = overrides
  return {
    id: overrides.id ?? `set-${Math.random().toString(36).slice(2)}`,
    date: overrides.date ?? '2026-04-01T12:00:00Z',
    weight,
    reps,
    estimated1RM: overrides.estimated1RM ?? epley(weight, reps),
  }
}

/**
 * Build an Exercise with the given name and a pre-built list of sets.
 * Tags default to empty; pass overrides to change id, tags, or other
 * fields. Compose with `makeSet()` at the call site when test data
 * cares about specific weight/rep values.
 */
export function makeExercise(name: string, sets: WorkoutSet[] = [], overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: overrides.id ?? `ex-${name}`,
    name,
    tags: [],
    sets,
    ...overrides,
  }
}
