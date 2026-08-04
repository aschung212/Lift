import { test, expect, type Page } from '@playwright/test'

// LIFT-889 — E2E guard for the offline write-queue / durable-replay path.
//
// The durable syncQueue journals every workout write to IndexedDB so that a set
// logged with no connectivity survives a tab close and is replayed on the next
// launch (CLAUDE.md → "Durable write queue"). Unit coverage
// (syncQueueJournal.test.ts, syncPipelineIntegration.test.ts) exercises the
// journal against a mocked Supabase; nothing drove the real browser flow end to
// end.
//
// The e2e build authenticates via the dev button and ships WITHOUT Supabase
// credentials (see the `VITE_E2E` job in ci.yml), so there is no server to
// reconcile against here. What these specs guard is the user-observable half of
// that guarantee, which is exactly what a real regression would break first:
//   1. going offline surfaces the "changes saved locally" indicator, and
//   2. a set logged while offline is accepted immediately (the UI never waits on
//      the network) and still survives a full page reload — the local-first +
//      rehydrate path the journaled replay is layered on top of.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-complete', 'true')
    localStorage.setItem('rest-timer', 'off')
    localStorage.setItem('fresh-start', 'true')
  })
})

/** Sign in through the dev-only button and wait for the Workouts view. */
async function signInDev(page: Page): Promise<void> {
  await page.locator('.authDevBtn').click({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
}

/** Log a set into the currently-open log modal, then close it. */
async function logSetInModal(page: Page, weight: string, reps: string): Promise<void> {
  await expect(page.locator('#log-modal-title')).toBeVisible()
  await page.fill('[aria-label="Weight"]', weight)
  await page.fill('[aria-label="Reps"]', reps)
  await page.locator('.repMaxBtnCalc').click()
  await page.locator('.repMaxBtnClose').click()
}

/** Create the first exercise (via the fresh-start CTA) with one logged set. */
async function createExerciseWithSet(page: Page, name: string, weight: string, reps: string): Promise<void> {
  await page.locator('.wtFreshStartCta').click()
  await page.fill('input[placeholder="e.g. Bench Press"]', name)
  await logSetInModal(page, weight, reps)
  await expect(page.locator('.wtExerciseName', { hasText: name })).toBeVisible()
}

/** Open the exercise detail modal and assert its logged-set count. */
async function expectSetCount(page: Page, name: string, count: number): Promise<void> {
  await page.locator('.wtExerciseRow').filter({ hasText: name }).click()
  await expect(page.locator('.wtDetailTitle')).toHaveText(name)
  await expect(page.locator('.wtSetRow')).toHaveCount(count)
  // Close the detail modal so the next interaction starts from a clean surface.
  await page.keyboard.press('Escape')
}

/** Sign out via Settings → confirm dialog, returning to the auth screen. */
async function signOutViaSettings(page: Page): Promise<void> {
  await page.locator('.settingsGearBtn').click()
  await expect(page.locator('.settingsSheet')).toBeVisible()
  await page.locator('.settingsSignOut').click()
  // Sign-out routes through the shared confirm dialog (alertdialog).
  await page.locator('.confirmBtnConfirm').click()
  await expect(page.locator('.authDevBtn')).toBeVisible({ timeout: 10000 })
}

test.describe('Offline write durability', () => {
  test('offline set is accepted immediately, shows the offline indicator, and survives an online reload', async ({ page, context }) => {
    await page.goto('/')
    await signInDev(page)

    // Baseline set logged while online.
    await createExerciseWithSet(page, 'Squat', '225', '5')

    // Drop connectivity. The app listens for the `offline` event and flips its
    // sync status to "Offline — changes saved locally".
    await context.setOffline(true)
    await expect(page.locator('.syncIndicator--offline')).toBeVisible()

    // A set logged with no network must be accepted instantly (local-first) —
    // the UI never blocks on a server round-trip.
    await page.locator('.wtExerciseLogBtnCircle').click()
    await logSetInModal(page, '235', '5')
    await expectSetCount(page, 'Squat', 2)

    // Restore connectivity; the offline indicator clears.
    await context.setOffline(false)
    await expect(page.locator('.syncIndicator--offline')).toBeHidden()

    // Reload while online: assets refetch cleanly and the offline-logged set is
    // rehydrated from local storage — no data loss across the reload boundary.
    await page.reload()
    await signInDev(page)
    await expectSetCount(page, 'Squat', 2)
  })

  test('offline set survives a reload performed WHILE offline (service-worker cache)', async ({ page, context }) => {
    // Reloading with no network only works when a service worker can serve the
    // shell + assets from cache. That exists in the CI preview (production)
    // build but not under the local dev server, so this reload-while-offline
    // assertion is skipped when no SW controls the page.
    await page.goto('/')
    // Second navigation gives an installed SW a chance to take control of the
    // document (the controller is null on the very first visit).
    await page.reload()
    await signInDev(page)

    const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller)
    test.skip(!controlled, 'No service worker controls the page (dev server) — offline reload cannot be served from cache')

    await createExerciseWithSet(page, 'Deadlift', '315', '3')

    await context.setOffline(true)
    await expect(page.locator('.syncIndicator--offline')).toBeVisible()

    await page.locator('.wtExerciseLogBtnCircle').click()
    await logSetInModal(page, '335', '1')
    await expectSetCount(page, 'Deadlift', 2)

    // Reload with connectivity still cut — served entirely from the SW cache.
    await page.reload()
    await signInDev(page)
    await expectSetCount(page, 'Deadlift', 2)

    await context.setOffline(false)
  })
})

// LIFT-1008 — the shared-device replay invariant.
//
// The durable write queue journals pending writes to IndexedDB and replays them
// on the next launch. That durability MUST be scoped to the user who created it:
// signing out wipes the journal AND resets every store so the next person on a
// shared device (a gym iPad, a borrowed phone) never sees — or, once a backend is
// wired, re-uploads — the previous user's sets (CLAUDE.md → "Durable write queue":
// "The journal is wiped on sign-out so a shared device never replays the previous
// user's writes"). `useAuth.signOut` enforces this via `syncQueue.clear()` +
// `resetStores()`.
//
// The e2e build ships without Supabase credentials, so there is no server round
// trip and the journal never activates — but the *user-observable* half of the
// guarantee is fully exercisable: a set logged by user A must not survive a
// sign-out into user B's fresh session on the same device, even across a reload
// (which rehydrates the stores straight from local storage). That reload is the
// closest proxy to the journal-replay path an offline, backend-less build can
// drive, and it is exactly what a broken reset would leak through.
test.describe('Shared-device sign-out isolation', () => {
  test('a signed-out session leaves no logged sets for the next user, even after a reload', async ({ page }) => {
    await page.goto('/')
    await signInDev(page)

    // User A logs a set. It is persisted to local storage (local-first).
    await createExerciseWithSet(page, 'Bench Press', '185', '5')
    await expect(page.locator('.wtExerciseRow')).toHaveCount(1)

    // Sign out. This must wipe the durable journal and reset the stores so the
    // persisted set no longer hydrates on the next launch.
    await signOutViaSettings(page)

    // Reload to fully re-bootstrap from local storage (the same path the journal
    // replay is layered on). The init script re-primes onboarding-complete /
    // fresh-start so the next dev sign-in lands on a clean Workouts surface.
    await page.reload()
    await signInDev(page)

    // User B sees a genuinely empty slate — the previous user's exercise and set
    // did not survive the sign-out. The fresh-start CTA is the empty-state tell.
    await expect(page.locator('.wtExerciseRow')).toHaveCount(0)
    await expect(page.locator('.wtFreshStartCta')).toBeVisible()
  })
})
