/**
 * Native bridge for the iOS Live Activity / Dynamic Island rest timer.
 *
 * Mirrors a running rest timer onto the Lock Screen and Dynamic Island via
 * ActivityKit so the countdown is visible without reopening the app — the
 * iOS-native equivalent of the in-app rest timer (parity with Hevy). This is
 * distinct from the rest-complete notification (#331): a Live Activity is a
 * continuously-updating countdown surface, not a one-shot alert.
 *
 * Uses Capacitor's `registerPlugin` so the web build has zero static dependency
 * on a native-only plugin — the proxy is only ever invoked inside a real native
 * iOS shell. On web, Android, and in tests every call is a no-op. The matching
 * Swift ActivityKit plugin and widget extension are wired up as part of the
 * Capacitor iOS build (#531/#726). Until then this resolves to a no-op on every
 * platform; the lifecycle decisions are exercised in tests independent of the
 * native bridge.
 *
 * Live Activities require iOS 16.1+; ActivityKit has no Android equivalent, so
 * the bridge is gated to native iOS.
 */
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from './platform'
import { logError } from './logger'

/**
 * The state pushed to the Live Activity. `endTimeMs` drives the OS-rendered
 * self-updating countdown (SwiftUI `Text(timerInterval:)`) so the lock-screen
 * timer keeps ticking even while JS is suspended; `remainingSeconds` is the
 * authoritative value while paused (the OS can't run a live countdown then).
 */
export interface RestTimerActivityState {
  /** Total rest duration in seconds — the progress-ring denominator. */
  durationSeconds: number
  /** Epoch ms when the timer reaches zero. Drives the live countdown. */
  endTimeMs: number
  /** Seconds remaining now — authoritative while paused, a hint while running. */
  remainingSeconds: number
  /** Whether the timer is paused (OS shows a static value, not a countdown). */
  paused: boolean
}

interface RestTimerActivityPlugin {
  /** Begin a Live Activity for a freshly-started rest timer. */
  start(state: RestTimerActivityState): Promise<void>
  /** Push new state to the running Live Activity (pause/resume/restart/retime). */
  update(state: RestTimerActivityState): Promise<void>
  /** Dismiss the Live Activity (timer stopped or completed). */
  end(): Promise<void>
}

const RestTimerActivityNative = registerPlugin<RestTimerActivityPlugin>('RestTimerLiveActivity')

/** Whether the current platform can host a rest-timer Live Activity (native iOS only). */
function supportsLiveActivity(): boolean {
  return isNative && platform === 'ios'
}

/**
 * Normalize raw timer values into a Live Activity payload.
 *
 * Pure and side-effect free so the lifecycle math is testable without a native
 * bridge: durations and remaining seconds are clamped to non-negative integers
 * and `remainingSeconds` is never reported larger than the total duration.
 */
export function buildRestTimerActivityState(input: {
  durationSeconds: number
  endTimeMs: number
  remainingSeconds: number
  paused: boolean
}): RestTimerActivityState {
  const durationSeconds = Math.max(0, Math.floor(input.durationSeconds) || 0)
  const remainingSeconds = Math.min(
    durationSeconds,
    Math.max(0, Math.floor(input.remainingSeconds) || 0),
  )
  const endTimeMs = Math.max(0, Math.floor(input.endTimeMs) || 0)
  return {
    durationSeconds,
    endTimeMs,
    remainingSeconds,
    paused: Boolean(input.paused),
  }
}

/** Start a Live Activity for a running rest timer. No-ops off native iOS. */
export async function startRestTimerActivity(state: RestTimerActivityState): Promise<void> {
  if (!supportsLiveActivity()) return
  try {
    await RestTimerActivityNative.start(state)
  } catch (e) {
    logError(e, { source: 'restTimerActivity.startRestTimerActivity' })
  }
}

/** Push updated state to a running Live Activity. No-ops off native iOS. */
export async function updateRestTimerActivity(state: RestTimerActivityState): Promise<void> {
  if (!supportsLiveActivity()) return
  try {
    await RestTimerActivityNative.update(state)
  } catch (e) {
    logError(e, { source: 'restTimerActivity.updateRestTimerActivity' })
  }
}

/** Dismiss the rest-timer Live Activity. No-ops off native iOS. */
export async function endRestTimerActivity(): Promise<void> {
  if (!supportsLiveActivity()) return
  try {
    await RestTimerActivityNative.end()
  } catch (e) {
    logError(e, { source: 'restTimerActivity.endRestTimerActivity' })
  }
}
