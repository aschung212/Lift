import { ref, type Ref } from 'vue'
import { supabase } from '../lib/supabase'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { usePreferencesStore } from '../stores/preferences'
import { useProgressionStore } from '../stores/progression'
import { resetXPCeremony } from '../composables/xpCeremonyUI'
import { syncQueue } from '../lib/syncQueue'
import { deleteAllIDB } from '../lib/durableStorage'
import { onForegroundResume } from '../lib/foregroundResume'
import { logError } from '../lib/logger'
import { clearReauthFlag, isRetryableAuthFetchError, sessionAwaitingRefresh } from '../lib/sessionHealth'
import { readStoredSession, clearStoredSession, type StoredSession } from '../lib/storedSession'
import { isNative } from '../lib/platform'
import { APP_URL } from '../lib/appMeta'
import type { AuthChangeEvent, Session, User, Provider } from '@supabase/supabase-js'

interface AuthError {
  message: string
}

export interface UseAuthReturn {
  user: Ref<User | { id: string; email: string } | null>
  loading: Ref<boolean>
  isGuest: Ref<boolean>
  init: () => void
  signInWithProvider: (provider: Provider) => Promise<{ error: AuthError | null }>
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsConfirmation?: boolean }>
  requestPasswordReset: (email: string) => Promise<{ error: AuthError | null }>
  confirmPasswordReset: (email: string, code: string, password: string) => Promise<{ error: AuthError | null }>
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>
  passwordRecoveryPending: Ref<boolean>
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
  devSignIn: () => Promise<void>
  continueAsGuest: () => void
  exitGuestMode: () => void
  deleteAccount: () => Promise<void>
  destroy: () => void
}

// Local-only "guest" mode (LIFT-1083): the app is local-first (Pinia +
// localStorage is the source of truth), so it fully works with no account.
// A guest sets a local user identity WITHOUT calling initStores — so the
// stores' `_userId` stays null and nothing is ever enqueued to Supabase. The
// flag is persisted so the guest is restored on reload instead of being bounced
// back to the auth gate. When a guest later creates a real account, the normal
// SIGNED_IN path runs initStores → migrateLocalStorageToSupabase, so their
// device-local data is backed up on conversion.
const GUEST_MODE_KEY = 'guest-mode'
const GUEST_USER_ID = 'guest-local'
/** Persisted dismissal of the "create an account to back up" nudge (App.vue). */
export const GUEST_BACKUP_PROMPT_DISMISSED_KEY = 'guest-backup-prompt-dismissed'

const user: Ref<User | { id: string; email: string } | null> = ref(null)
const loading: Ref<boolean> = ref(true)
const isGuest: Ref<boolean> = ref(false)
/**
 * Raised by a PASSWORD_RECOVERY auth event — the web landing of an emailed
 * reset link — so App.vue can offer PasswordResetSheet (#1430). The in-app
 * code flow (confirmPasswordReset) makes verifyOtp fire the same event but sets
 * the password itself, so it suppresses the prompt via handlingCodeReset.
 */
const passwordRecoveryPending: Ref<boolean> = ref(false)
let handlingCodeReset = false

let _initialized = false
let _authUnsubscribe: (() => void) | null = null
let _lifecycleCleanups: Array<() => void> = []

/**
 * Re-arm supabase-js token auto-refresh on app resume (LIFT-784).
 *
 * supabase-js pauses its refresh timer while the document is hidden and relies
 * on `visibilitychange` to resume — but that event is unreliable in
 * WKWebView/Capacitor (the App Store target) when coming back from the
 * background, so the access token can quietly expire mid-session. The redundant
 * `visibilitychange` + `focus` + `pageshow` set that answers that now lives in
 * `onForegroundResume` (LIFT-1392), shared with the read-path recovery that
 * had drifted to a subset of it. `startAutoRefresh()` immediately checks the
 * token and refreshes it if it is within the expiry margin; `stopAutoRefresh()`
 * on hide avoids a wasted timer.
 */
function setupSessionRefreshLifecycle(): void {
  if (!supabase) return
  const client = supabase
  _lifecycleCleanups.push(onForegroundResume(
    () => { void client.auth.startAutoRefresh() },
    {
      onHide: () => { void client.auth.stopAutoRefresh() },
      // Kick off the loop for the session that is already in the foreground.
      immediate: true,
    },
  ))
}

/**
 * One sign-in's store initialisation, split where the network starts
 * (LIFT-1516). The splash used to wait for all of it, a migration count query
 * and then four store reads, even though every store had already hydrated
 * from localStorage. A dead uplink therefore held a lifter whose data was all
 * on the device behind postgrest-js's 1s/2s/4s GET retries plus the browser's
 * own network timeout on every attempt.
 */
interface StoresInit {
  userId: string
  /** Every store is attached to the account. Local work only, so the splash can wait for it. */
  bound: Promise<void>
  /** The migration and every store's first read have settled. Nothing on screen waits for it. */
  synced: Promise<void>
}

// LIFT-1212: on a signed-in cold start BOTH the getSession() resolution and
// the INITIAL_SESSION/SIGNED_IN auth event fire, and each called initStores
// unguarded (the event path's `wasUnauthenticated` check only helps when
// getSession wins the race). A double run means a duplicate localStorage→
// Supabase migration, duplicate store hydration, and duplicate settings
// watchers — the reachable trigger for the #787 migration race. Coalesce per
// user: concurrent and repeat calls for the same user share one run. The
// cache clears on teardown (sign-out) so the same user re-inits on their next
// sign-in, and on failure so a transient error doesn't poison future inits.
let _storesInit: StoresInit | null = null
// Bumped by every registration and every reset, so a run can tell after each
// of its awaits whether it has been superseded: by a sign-out, or by the next
// sign-in.
let _storesInitGeneration = 0

function resetInitStoresGuard(): void {
  _storesInit = null
  _storesInitGeneration++
}

function initStores(userId: string): StoresInit {
  if (_storesInit?.userId === userId) return _storesInit
  const generation = ++_storesInitGeneration
  const isCurrent = (): boolean => _storesInitGeneration === generation
  const bound = bindStores(userId, isCurrent)
  const synced = bound.then(() => syncStores(userId, isCurrent))
  synced.catch((err: unknown) => {
    // Every caller starts a run and moves on, so its failure is reported here,
    // once, instead of leaking to the global floor (LIFT-1227). Then clear only
    // OUR OWN registration: after a sign-out + fast re-sign-in of the same
    // user, a NEWER generation owns the guard, and a stale rejection from this
    // superseded run must not wipe it — that would let a later call start a
    // third, duplicate init. (Same identity discipline as the LIFT-1213
    // journal guard; flagged by the 2026-08-26 adversarial review.)
    logError(err, { source: 'useAuth', action: 'initStores' })
    if (isCurrent()) resetInitStoresGuard()
  })
  _storesInit = { userId, bound, synced }
  return _storesInit
}

/**
 * The half of sign-in the splash waits for. It is local work only.
 *
 * The durable journal is replayed FIRST, and that order is load-bearing.
 * Binding is what lets a store enqueue a write, and the first journaled write
 * persists the in-memory journal over the copy in IndexedDB. A write enqueued
 * before `rehydrate()` has read that copy would erase every write the last
 * session left unsent, and the user can act the moment the stores are bound.
 */
async function bindStores(userId: string, isCurrent: () => boolean): Promise<void> {
  // Replay any writes that were journaled to IndexedDB but never reached the
  // server before the app last closed (LIFT-706). Safe + idempotent.
  await syncQueue.rehydrate()
  // Signed out while the journal was being read: binding now would attach the
  // stores to a session that has already ended.
  if (!isCurrent()) return
  // One store at a time, so a store that throws cannot leave the other three
  // unbound: the LIFT-820 rule the reads below keep with allSettled.
  const stores = [useWorkoutStore(), useBodyweightStore(), usePreferencesStore(), useProgressionStore()]
  for (const store of stores) {
    try {
      store.bindUser(userId)
    } catch (err) {
      logError(err, { source: 'useAuth', action: 'initStores:bind' })
    }
  }
}

/**
 * The half of sign-in nothing on screen waits for: the network. It runs with
 * the app up and the stores bound, the same state a foreground-resume re-fetch
 * runs in, so it keeps that path's writes-before-reads rule.
 */
async function syncStores(userId: string, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return
  await migrateLocalStorageToSupabase(userId)
  if (!isCurrent()) return
  // Writes before reads, as useSyncRecovery's run() does. The user can act
  // while the migration is out, and rehydrate() has just re-queued what the
  // last session left unsent. A read that lands ahead of those writes merges
  // the server's older copy over them: a settings change flips back, and
  // progression's union merge re-adds a deleted set's XP, then pushes it.
  await syncQueue.flush()
  if (!isCurrent()) return
  // allSettled (not all): each store's read already swallows its own failures,
  // but allSettled is defense-in-depth so a future regression that lets one
  // reject can never abort the other three (LIFT-820).
  const results = await Promise.allSettled([
    useWorkoutStore()._fetchFromSupabase(),
    useBodyweightStore()._fetchFromSupabase(),
    usePreferencesStore()._fetchFromSupabase(),
    useProgressionStore()._fetchFromSupabase(),
  ])
  for (const r of results) {
    if (r.status === 'rejected') {
      logError(r.reason, { source: 'useAuth', action: 'initStores' })
    }
  }
  // Theme/colorMode are read directly from the preferences store via computeds
  // now (LIFT-1177); connectThemeStore() (App.vue) keeps the DOM in sync, so no
  // one-shot bridge is needed here.
}

/**
 * How long a signed-in cold start with NOTHING of the user's on the device
 * waits for the account's first read before rendering anyway (LIFT-1516).
 */
export const FIRST_READ_GRACE_MS = 5000

/** Whether the stores hold any of the user's data, i.e. anything to show. */
function storesHoldLocalData(): boolean {
  return useWorkoutStore().exercises.length > 0 || useBodyweightStore().entries.length > 0
}

/** Resolves when `promise` settles or `ms` elapses, whichever comes first. */
function settledOrElapsed(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}

/**
 * Lift the splash for a signed-in cold start once the stores are bound, not
 * once they have read the server (LIFT-1516). Every store hydrated from
 * localStorage when it was created, so binding is all the app needs to be
 * correct on screen. The reads run behind it and land the way a resume's do.
 *
 * The one wait left is for a device that holds nothing of this user's: a new
 * browser, a reinstall, or an OAuth redirect landing on either. There only the
 * first read can tell a returning lifter from a new one, and rendering without
 * it would put a returning lifter into onboarding. The wait is capped, so a
 * dead uplink costs FIRST_READ_GRACE_MS rather than every retry.
 */
async function liftSplashWhenBound(run: StoresInit): Promise<void> {
  try {
    await run.bound
    if (!storesHoldLocalData()) await settledOrElapsed(run.synced, FIRST_READ_GRACE_MS)
  } catch {
    // Already reported: a failed bind fails `synced`, which initStores logs.
    // The splash comes down regardless, because the app is local-first and
    // renders from localStorage either way (LIFT-1324).
  } finally {
    loading.value = false
  }
}

/** Clear guest mode (a real session supersedes it). */
function clearGuestFlag(): void {
  isGuest.value = false
  localStorage.removeItem(GUEST_MODE_KEY)
}

/**
 * Restore a persisted guest session so a reload keeps the user in the app
 * instead of bouncing them back to the auth gate. Returns true if a guest was
 * restored.
 */
function restoreGuestIfFlagged(): boolean {
  if (localStorage.getItem(GUEST_MODE_KEY) === 'true') {
    isGuest.value = true
    user.value = { id: GUEST_USER_ID, email: '' }
    return true
  }
  return false
}

// ── A stored session auth-js cannot refresh yet (LIFT-1545) ─────────
// More than an hour after the last session the access token has expired, and
// getSession() will not answer until auth-js has refreshed it. Offline, that
// refresh retries for about 25 s (one browser timeout on a dead uplink), keeps
// the session in storage because the failure is retryable, and then answers
// `session: null`. Read as "signed out", that held the splash for the retries
// and then showed the sign-in screen to a lifter whose data was all on the
// device; the auto-refresh signed them back in only once the network returned.
//
// Instead the user of the stored session stays signed in, locally, until a
// refresh confirms it. No store is bound meanwhile: a request with no usable
// token goes out under the anon key, and RLS answers a read like that with
// empty rows rather than an error, so reading would merge every store against
// an "empty" account. Edits stay on the device like a guest's and reach the
// account through the read that follows the refresh. That read already pushes
// any set, exercise, weigh-in or delete the server lacks, and the two
// whole-row stores are held so it replays their edits too.

/**
 * How long a cold start waits for auth-js to confirm the session stored on
 * this device before showing the app from it anyway (LIFT-1545). Long enough
 * for a token refresh on a slow but working connection, where a revoked
 * session would otherwise flash the app before the sign-in screen.
 */
export const STORED_SESSION_GRACE_MS = 2000

/**
 * auth-js refreshes an access token this close to expiry before getSession()
 * answers for it (its EXPIRY_MARGIN_MS). Any other stored session is answered
 * from storage at once, so only these can be waiting on the network.
 */
const REFRESH_MARGIN_MS = 90_000

let _restoreTimer: ReturnType<typeof setTimeout> | null = null

function cancelRestoreTimer(): void {
  if (_restoreTimer !== null) clearTimeout(_restoreTimer)
  _restoreTimer = null
}

/**
 * Sign in the user of the stored session, locally, without binding any store.
 * Returns false, changing nothing, when no session auth-js could refresh is
 * stored.
 */
function restoreStoredSession(stored: StoredSession | null = readStoredSession()): boolean {
  if (sessionAwaitingRefresh.value) return true
  if (!stored) return false
  user.value = stored.user
  sessionAwaitingRefresh.value = true
  usePreferencesStore().holdUntilRead(stored.user.id)
  useProgressionStore().holdUntilRead(stored.user.id)
  loading.value = false
  return true
}

/**
 * Settle the stored session against getSession()'s answer. Returns true when
 * the user stays signed in from it: auth-js kept the session but could not
 * refresh it for a network reason. Any other answer is final, a session to bind
 * or none at all, and is left to the caller's own branch.
 */
function keepStoredSession(session: Session | null, error: unknown): boolean {
  cancelRestoreTimer()
  if (!session && isRetryableAuthFetchError(error)) return restoreStoredSession()
  sessionAwaitingRefresh.value = false
  return false
}

/** getSession() failed outright: a restored session was never confirmed, so drop it. */
function dropStoredSession(): void {
  cancelRestoreTimer()
  if (!sessionAwaitingRefresh.value) return
  sessionAwaitingRefresh.value = false
  user.value = null
}

/**
 * Settle a restored session against an auth event. A session means a refresh
 * went through: returns true so the caller binds it. SIGNED_OUT means the
 * refresh token was rejected: the user goes back to the sign-in screen
 * WITHOUT the sign-out teardown, because no store was ever bound to this
 * session, and its data stays on the device as an offline cold start always
 * left it.
 */
function settleRestoredSession(event: AuthChangeEvent, session: Session | null): boolean {
  if (!sessionAwaitingRefresh.value) return false
  if (session?.user) {
    sessionAwaitingRefresh.value = false
    return true
  }
  if (event === 'SIGNED_OUT') {
    sessionAwaitingRefresh.value = false
    user.value = null
  }
  return false
}

function init(): void {
  if (_initialized) return
  _initialized = true

  // Dev mode or Supabase unavailable: fall back to local-only mode
  if (import.meta.env.DEV || !supabase) {
    restoreGuestIfFlagged()
    loading.value = false
    return
  }

  // Show the app from the stored session if auth-js is still refreshing it
  // when the grace period ends (LIFT-1545). A browser that knows it is offline
  // gets no grace: that refresh cannot succeed.
  _restoreTimer = setTimeout(() => {
    _restoreTimer = null
    const stored = readStoredSession()
    if (user.value === null && stored && stored.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      restoreStoredSession(stored)
    }
  }, typeof navigator !== 'undefined' && navigator.onLine === false ? 0 : STORED_SESSION_GRACE_MS)

  supabase.auth.getSession().then(({ data: { session }, error }) => {
    if (keepStoredSession(session, error)) return
    if (session?.user) {
      user.value = session.user
      // A real session supersedes any prior guest mode.
      clearGuestFlag()
      void liftSplashWhenBound(initStores(session.user.id))
    } else {
      user.value = null
      restoreGuestIfFlagged()
      loading.value = false
    }
  }).catch((err) => {
    dropStoredSession()
    logError(err, { source: 'useAuth', action: 'getSession' })
    restoreGuestIfFlagged()
    loading.value = false
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    // Runs first so a SIGNED_OUT for a restored session finds no prior user
    // below, and so nothing is torn down for it (LIFT-1545).
    const confirmsRestored = settleRestoredSession(event, session)
    const prev = user.value
    // A guest converting to a real account has a truthy `prev` (the guest
    // identity), so `!prev` alone would skip initStores — and with it the
    // local→Supabase migration. Init when the previous state had no real
    // account: either signed out (`!prev`), a guest (LIFT-1083), or a session
    // restored from storage that no store was bound to (LIFT-1545).
    const wasUnauthenticated = !prev || isGuest.value || confirmsRestored
    // A successful (re)auth means the token is healthy again — clear any
    // pending "re-sign-in needed" prompt (LIFT-784).
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') clearReauthFlag()
    if (event === 'PASSWORD_RECOVERY' && !handlingCodeReset) passwordRecoveryPending.value = true
    if (session?.user) {
      user.value = session.user
      if (wasUnauthenticated) {
        clearGuestFlag()
        // Fire-and-forget re-auth init. The run reports its own failure
        // (initStores), so nothing leaks to the global floor (LIFT-1227).
        initStores(session.user.id)
      }
    } else if (event === 'SIGNED_OUT') {
      passwordRecoveryPending.value = false
      // A SIGNED_OUT event ends the session — either the user tapped sign-out,
      // or the refresh token expired / was revoked server-side and supabase-js
      // dropped the session automatically. Both must run the SAME teardown as
      // manual signOut (clear the sync journal + reset stores), or the previous
      // user's hydrated Pinia stores and durable IndexedDB journal would persist
      // under a now-anonymous session — the exact shared-device leak the
      // journal-wipe exists to prevent, reached via the automatic path
      // (LIFT-1133). Guard on a real prior user: a guest keeps its local-only
      // data (isGuest), and an already-signed-out state has nothing to tear
      // down. A null-session INITIAL_SESSION event never reaches this branch, so
      // it still can't clobber a guest that getSession() restored.
      if (prev && !isGuest.value) {
        teardownSession()
      } else {
        user.value = null
      }
    }
  })
  _authUnsubscribe = () => subscription.unsubscribe()

  setupSessionRefreshLifecycle()
}

/**
 * Enter local-only guest mode (LIFT-1083). Deliberately does NOT init stores:
 * the stores already hydrated from localStorage at instantiation, and leaving
 * `_userId` null keeps every write local (nothing is enqueued to Supabase). The
 * user is prompted to create an account later to back up / sync.
 */
function continueAsGuest(): void {
  localStorage.setItem(GUEST_MODE_KEY, 'true')
  isGuest.value = true
  user.value = { id: GUEST_USER_ID, email: '' }
  loading.value = false
}

/**
 * Leave guest mode to return to the auth screen (e.g. to create an account).
 * Preserves all local data — does NOT resetStores — so signing up migrates the
 * guest's existing workouts to their new account.
 */
function exitGuestMode(): void {
  clearGuestFlag()
  user.value = null
}

async function signInWithProvider(provider: Provider): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin }
  })
  return { error }
}

async function signInWithEmail(email: string, password: string): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error }
}

async function signUp(email: string, password: string): Promise<{ error: AuthError | null; needsConfirmation?: boolean }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (!error && data?.user?.identities?.length === 0) {
    return { error: { message: 'An account with this email already exists.' } }
  }
  return { error, needsConfirmation: !error && !!data?.user && !data?.session }
}

/**
 * Password reset, step 1 (#1430): ask Supabase for the recovery email. The
 * LINK in it only completes in the origin that requested it — supabase-js
 * keeps the PKCE code_verifier in that origin's storage and exchanges the
 * link's `?code=` against it — which no native install can be (its origin is
 * capacitor://localhost, and the link opens Safari). So on native the link is
 * pointed at the PWA, where it at least lands on a real page, and the emailed
 * CODE (confirmPasswordReset) is the path that works everywhere.
 */
async function requestPasswordReset(email: string): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const redirectTo = isNative ? APP_URL : window.location.origin
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  return { error }
}

/**
 * Password reset, step 2: verify the emailed code — a recovery OTP, so the
 * Supabase "Reset Password" template must include `{{ .Token }}` — which signs
 * the user in, then set the new password on that session. verifyOtp fires
 * PASSWORD_RECOVERY exactly as a link landing would; handlingCodeReset keeps the
 * handler from ALSO raising the in-app sheet for a password about to be set.
 */
async function confirmPasswordReset(email: string, code: string, password: string): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  handlingCodeReset = true
  try {
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' })
    if (verifyError) return { error: verifyError }
    const { error } = await supabase.auth.updateUser({ password })
    // Verified but not updated: the session is real, so leave the in-app sheet
    // armed for another try rather than keeping the old password silently.
    passwordRecoveryPending.value = !!error
    return { error }
  } finally {
    handlingCodeReset = false
  }
}

/** Set a new password on the current session (PasswordResetSheet, #1430). */
async function updatePassword(password: string): Promise<{ error: AuthError | null }> {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { error } = await supabase.auth.updateUser({ password })
  if (!error) passwordRecoveryPending.value = false
  return { error }
}

/** "Not now" on the reset sheet: the session from the link is real either way. */
function clearPasswordRecovery(): void {
  passwordRecoveryPending.value = false
}

async function devSignIn(): Promise<void> {
  user.value = { id: 'local-dev', email: 'dev@localhost' }
  await initStores('local-dev').synced
}

function resetStores(): void {
  useWorkoutStore().$reset()
  useBodyweightStore().$reset()
  usePreferencesStore().$reset()
  useProgressionStore().$reset()
  // Transient XP-ceremony UI lives outside the stores (LIFT-823); clear it and
  // its auto-dismiss timer so a shared device never shows the previous user's
  // toast/celebration.
  resetXPCeremony()
}

/**
 * Shared teardown for the end of a real (non-guest) session, invoked by BOTH
 * the manual `signOut()` and the automatic server-side sign-out branch of
 * `onAuthStateChange` (LIFT-1133).
 *
 * Cancels pending syncs and wipes the durable IndexedDB journal so the next
 * user on a shared device never replays this user's writes (LIFT-706), resets
 * every Pinia store, and clears the user. Idempotent — running it twice is
 * harmless, which matters because a manual `signOut()` also emits a `SIGNED_OUT`
 * event that lands in the same teardown.
 */
function teardownSession(): void {
  syncQueue.clear()
  resetStores()
  user.value = null
  // The next sign-in (same user included) must re-hydrate from scratch.
  resetInitStoresGuard()
}

async function signOut(): Promise<void> {
  // A session restored from storage has no access token auth-js could revoke,
  // and its signOut() would first retry the refresh it is already failing (a
  // browser timeout on a dead uplink) before giving up (LIFT-1545).
  const restored = sessionAwaitingRefresh.value
  try {
    if (!restored) await supabase?.auth.signOut()
  } catch {
    // Network errors during sign-out should not block clearing the user
  } finally {
    // auth-js's signOut() refreshes an expired access token first, and when
    // that fails retryably (offline, a dead uplink, an auth outage) it returns
    // without removing the session. Left in storage, the next refresh that
    // succeeds (the auto-refresh ticker once the network is back, or the next
    // launch) signs this user straight back in. A no-op after a sign-out that
    // did remove it.
    clearStoredSession()
    sessionAwaitingRefresh.value = false
    teardownSession()
  }
}

/**
 * Extract a truthy Supabase error from a *resolved* (fulfilled) settled result.
 *
 * supabase-js resolves `{ data, error }` rather than rejecting on server-side
 * failures (RLS, FK/constraint, 401), so `status === 'rejected'` alone misses
 * them. Returns the error object when present, else null. Rejected results are
 * handled separately by their `.reason`.
 */
function resolvedDeleteError(result: PromiseSettledResult<unknown>): unknown {
  if (result.status !== 'fulfilled') return null
  const val = result.value as { error?: unknown } | null | undefined
  if (val && typeof val === 'object' && 'error' in val && val.error) return val.error
  return null
}

/**
 * Render a PostgREST error object as a log line. `String(err)` on one yields
 * "[object Object]", which would strip the code/message a failed deletion needs.
 */
function describeSupabaseError(err: unknown): string {
  if (err && typeof err === 'object') {
    const { message, code } = err as { message?: unknown; code?: unknown }
    if (typeof message === 'string') return code ? `${message} (${String(code)})` : message
  }
  return String(err)
}

/**
 * Delete all user data from Supabase, delete the `auth.users` row itself
 * (#1299), clear local storage & IndexedDB, then sign out.
 *
 * Throws if any stage fails so the caller can show an error — and throws
 * BEFORE the local wipe, so a partial server-side deletion never leaves the
 * device cleared while rows survive.
 *
 * For a local-only guest session both server stages are skipped entirely
 * (LIFT-1301) — there is no account and no rows to delete — and the local wipe
 * is the whole operation.
 */
async function deleteAccount(): Promise<void> {
  // Cancel any pending sync operations to avoid racing with deletion
  syncQueue.clear()

  const userId = user.value?.id
  // A guest has no server rows to delete, and must not TRY (LIFT-1301). Guest
  // mode is local-only by construction — `continueAsGuest` deliberately skips
  // `initStores`, so `_userId` stays null and nothing is ever enqueued — but its
  // identity is the sentinel string `guest-local`, which is truthy and so passed
  // the `supabase && userId` gate. Every filter below then compares a `uuid`
  // column against a non-UUID, which PostgREST answers 400 / SQLSTATE 22P02
  // ("invalid input syntax for type uuid"). Since LIFT-1225 that RESOLVED error
  // is correctly counted as a failure, so the batch threw before the local wipe
  // — making "Delete Account" a deterministic dead-end for the one user who
  // needs no network to honour it. (The #1299 stage below is equally unusable
  // for a guest: `delete_user_account` derives its target from `auth.uid()`,
  // which a guest does not have.) Gate on the flag rather than the sentinel
  // value: `isGuest` is what every other guest branch keys off (App.vue's
  // `handleSignOut`, the SIGNED_OUT teardown), and it is the thing that means
  // "this session has no server side", of which the id is only a symptom.
  if (supabase && userId && !isGuest.value) {
    // Delete from Supabase tables. exercises CASCADE deletes sets.
    // Order: leaf tables first, then tables with foreign keys.
    const results = await Promise.allSettled([
      supabase.from('xp_events').delete().eq('user_id', userId),
      supabase.from('progression_snapshots').delete().eq('user_id', userId),
      supabase.from('user_progression').delete().eq('user_id', userId),
      supabase.from('user_preferences').delete().eq('user_id', userId),
      supabase.from('bodyweight_entries').delete().eq('user_id', userId),
      supabase.from('exercises').delete().eq('user_id', userId), // cascades to sets
      // The AI-Coach tables (coach_usage, coach_usage_log, coach_consent) are
      // the second half of LIFT-1225: they arrived in the 2026-06-27 migration,
      // years after this list was written, and nothing added them — so a user
      // who deleted their account left behind the record that they consented to
      // sending health data off-device plus a per-request audit trail. They
      // deliberately have RLS on with SELECT-only policies, which makes a client
      // `.from('coach_usage').delete()` the WRONG fix rather than a redundant
      // one: an RLS-blocked DELETE is not an error in Postgres — it removes zero
      // rows and PostgREST answers `{ error: null }`, so it would sail past the
      // check below and report success. The SECURITY DEFINER RPC (which derives
      // the user from auth.uid() internally) is the only path that actually
      // deletes, and it returns the same `{ data, error }` shape, so it joins
      // the batch and is held to the same standard.
      supabase.rpc('delete_coach_data'),
    ])

    // A genuine server-side delete failure must ABORT before we wipe local data,
    // or "delete my data" silently leaves server rows behind while the device is
    // cleared (a data-integrity and right-to-deletion/privacy bug). supabase-js
    // does NOT reject on RLS violations, FK/constraint errors, or an expired-token
    // 401 — it RESOLVES `{ data, error }` with a truthy `.error` (the exact
    // resolved-vs-rejected trap the sync queue already closed in LIFT-784). So a
    // settled result is a failure when it either rejected (network throw) OR
    // resolved carrying an error. An empty-table delete is not an error — it
    // resolves `{ error: null }` (0 rows), so this never false-positives.
    const failed = results.filter(r => r.status === 'rejected' || !!resolvedDeleteError(r))
    if (failed.length > 0) {
      // Report before throwing. The user only ever sees the generic message
      // below, so without this a failed right-to-deletion request leaves no
      // trace anywhere — the one failure mode that most needs a trail.
      const first = failed[0].status === 'rejected' ? failed[0].reason : resolvedDeleteError(failed[0])
      logError(first instanceof Error ? first : new Error(describeSupabaseError(first)), {
        source: 'deleteAccount:serverDelete',
        failedCount: failed.length,
      })
      throw new Error('Failed to delete server data. Please try again.')
    }

    // Now the account ITSELF (#1299). Everything above deletes the user's
    // application rows; the `auth.users` row — their email address, OAuth
    // identity linkage, created_at and last_sign_in_at — used to survive all of
    // it, indefinitely and with no remaining in-app way to remove it, while the
    // screen that triggered this said "Delete Account" / "Delete Everything".
    // The client holds the anon key and so cannot reach `auth.admin`; the
    // SECURITY DEFINER RPC (deriving the user from auth.uid() internally) is
    // its only path, the same shape delete_coach_data() already establishes.
    //
    // Ordering is load-bearing, which is why this is a second await rather than
    // another entry in the batch above: deleting the auth user CASCADES through
    // every `user_id` FK, so it is unrecoverable. Run last and a failure
    // anywhere earlier aborts while the account still exists and the user can
    // retry; run it first (or concurrently) and a later failure aborts having
    // already destroyed the account.
    const [accountResult] = await Promise.allSettled([supabase.rpc('delete_user_account')])
    const accountError = accountResult.status === 'rejected'
      ? accountResult.reason
      : resolvedDeleteError(accountResult)
    if (accountError) {
      // Report before throwing: the user only sees the message below, so
      // without this a half-completed deletion leaves no trace anywhere.
      logError(
        accountError instanceof Error ? accountError : new Error(describeSupabaseError(accountError)),
        { source: 'deleteAccount:deleteUserAccount' },
      )
      // Deliberately distinct from the message above, and deliberately honest
      // about the split outcome: the rows really are gone by this point, so
      // "failed to delete" would read as "nothing happened, cancel is safe".
      // Aborting here (before the local wipe and sign-out) keeps the retry
      // path open — the table deletes re-run harmlessly against 0 rows.
      throw new Error('Your data was deleted, but your sign-in could not be removed. Please try again.')
    }
  }

  // Wipe ALL app localStorage rather than a hand-maintained key list. Account
  // deletion ("delete my data") must leave nothing behind, and the previous
  // enumerated list had silently drifted from the keys the app actually writes
  // (LIFT-1176) — welcome-back, goal-celebration-state, active-gym-filter,
  // lift-tombstones, acquisition-source, install-prompt, notification-permission,
  // app-review and others survived deletion, so a shared device leaked one user's
  // data to the next. localStorage on this origin is exclusively the app's, so a
  // full clear is the drift-proof reconciliation the two sign-out paths need and
  // can never fall out of sync with a newly-added key. (signOut() below re-persists
  // the four stores' CLEARED payloads via $reset, so only defaults are written back.)
  try {
    localStorage.clear()
  } catch (e) {
    logError(e, { source: 'deleteAccount:clearStorage' })
  }

  // End guest mode explicitly (LIFT-1301). `localStorage.clear()` above already
  // removes GUEST_MODE_KEY, but the in-memory `isGuest` ref would survive it —
  // leaving the reactive flag and the storage it is persisted from disagreeing,
  // and making the end state a side effect of a call that never names the key.
  // Deleting everything ends the guest session: `signOut()` below nulls `user`,
  // so the user lands back on the auth gate with nothing carried over, exactly
  // as a signed-in user does. (Idempotent for a real session — the flag is
  // already false and the key already absent. It also re-runs the `removeItem`
  // on the path where `clear()` threw above.)
  clearGuestFlag()

  // Wipe the IndexedDB backup — the workout mirror AND the durable sync
  // journal. `deleteAllIDB` owns the mechanics (LIFT-1356): it clears the
  // store's contents first (a transaction is never blocked, so the data goes
  // even if a second tab holds the database open), closes this tab's cached
  // connection, and AWAITS each `deleteDatabase` request. The previous code
  // fired those requests and returned without observing them, so a delete
  // blocked by another open tab was indistinguishable from one that completed
  // and the previous user's backup survived on a shared device.
  await deleteAllIDB()

  // Sign out (clears auth session)
  await signOut()
}

function destroy(): void {
  _authUnsubscribe?.()
  _authUnsubscribe = null
  for (const cleanup of _lifecycleCleanups) cleanup()
  _lifecycleCleanups = []
  cancelRestoreTimer()
  sessionAwaitingRefresh.value = false
  _initialized = false
  resetInitStoresGuard()
}

export function useAuth(): UseAuthReturn {
  return { user, loading, isGuest, init, signInWithProvider, signInWithEmail, signUp, requestPasswordReset, confirmPasswordReset, updatePassword, passwordRecoveryPending, clearPasswordRecovery, signOut, devSignIn, continueAsGuest, exitGuestMode, deleteAccount, destroy }
}
