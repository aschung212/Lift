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
