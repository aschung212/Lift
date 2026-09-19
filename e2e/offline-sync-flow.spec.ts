import { test, expect, type Page } from '@playwright/test'
import { STUB_DISABLED_REASON, stubEnabled, stubRows, stubWrites } from './support/supabaseStub'

// LIFT-889 / LIFT-1008 — E2E guards for the offline write-queue and the durable
// replay path.
//
// The durable syncQueue journals every workout write to IndexedDB so that a set
// logged with no connectivity survives a tab close and is replayed on the next
// launch (CLAUDE.md → "Durable write queue"). Unit coverage
// (syncQueueJournal.test.ts, syncPipelineIntegration.test.ts) exercises the
// journal against a mocked Supabase.
//
// This file has two layers, because they fail for different reasons.
//
// 1. "Offline write durability" — the user-observable half, which needs no
//    server at all: going offline surfaces the "changes saved locally"
//    indicator, and a set logged offline is accepted immediately (the UI never
//    waits on the network) and survives a reload.
//
// 2. "Server-side reconciliation" (LIFT-1008) — the half nothing could reach
//    until the e2e build was given a Supabase endpoint. Every entry point of the
//    sync layer opens with `if (!supabase || isPreviewMode.value) return`, so a
//    credential-free build does not merely leave the queue untested: `enqueue`,
//    the IndexedDB journal, the offline park (LIFT-1322) and the reconnect
//    replay never execute a single line. `e2e/support/supabase-stub.mjs` is a
//    write-recording fake Supabase on loopback that closes that gap; it serves
//    every read as empty, so a row reaching it proves the CLIENT pushed it and
//    the other specs in this suite keep observing the same local-only state
//    they always have. See that file for the full rationale.

test.beforeEach(async ({ context }) => {
  // On the CONTEXT, not the page: the tab-kill spec below relaunches the app in
  // a second page of the same context, and a page-scoped init script would not
  // reach it.
  await context.addInitScript(() => {
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

/**
 * A name no other worker can be using. Spec files run in parallel against ONE
 * stub process under a single shared user id, so every server-side assertion
 * below is scoped by the exercise it was written against rather than by
 * wholesale stub state.
 */
function uniqueExerciseName(base: string): string {
  return `${base} ${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Wait for an exercise row to reach the stub, and return the id it was given.
 *
 * Every later assertion is scoped by that id rather than by name, and this is
 * load-bearing: because the stub answers every count as 0,
 * `migrateLocalStorageToSupabase` re-runs on each sign-in that finds data in
 * localStorage and pushes a copy of it under FRESHLY MINTED uuids. Keyed on the
 * id the app actually pushed, a migration copy can neither satisfy an assertion
 * nor pollute one.
 */
async function expectExerciseOnServer(name: string): Promise<string> {
  let id = ''
  await expect
    .poll(
      async () => {
        const row = (await stubRows('exercises')).find(r => r.name === name)
        id = row ? String(row.id) : ''
        return id !== ''
      },
      { timeout: 20000, message: `exercise "${name}" never reached the Supabase stub` },
    )
    .toBe(true)
  return id
}

/** Distinct set rows the client has pushed for one exercise. */
async function serverSetsFor(exerciseId: string): Promise<Record<string, unknown>[]> {
  return (await stubRows('sets')).filter(r => r.exercise_id === exerciseId)
}

/** Wait for one specific set to reach the stub. */
async function expectSetOnServer(exerciseId: string, weight: number, reps: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const sets = await serverSetsFor(exerciseId)
        return sets.some(s => Number(s.weight) === weight && Number(s.reps) === reps)
      },
      { timeout: 20000, message: `set ${weight} x ${reps} never reached the Supabase stub` },
    )
    .toBe(true)
}

/**
 * Hold still long enough that a write WOULD have landed, so "nothing was sent"
 * is a real observation rather than a race. The queue debounces flushes by 1s
 * (`new SyncQueue(1000)`), so this covers the whole window plus the round trip
 * to a loopback server.
 */
async function settleBeyondFlushDebounce(page: Page): Promise<void> {
  await page.waitForTimeout(3000)
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

// LIFT-1008 — what the client actually SENDS, observed on the wire.
//
// Everything above asserts on the UI, which is local-first and therefore looks
// identical whether the sync layer works perfectly or not at all. These three
// close that gap against `e2e/support/supabase-stub.mjs`, and each one guards a
// distinct promise that only a server can witness:
//
//   1. an offline write is PARKED, not attempted, and lands on reconnect
//      (LIFT-1322 — before that fix the retry budget burned against a dead radio
//      and the write was stranded until the next cold start);
//   2. a write survives the tab being KILLED with nothing flushed, which is the
//      iOS "backgrounded PWA reclaimed" shape and the app's clearest data-loss
//      path;
//   3. signing out wipes the journal, so the next person on a shared device
//      never re-uploads the previous user's sets.
//
// They skip wholesale when the build under test has no loopback stub — i.e.
// locally, where `initSupabase()` returns early on `import.meta.env.DEV` and
// there is no client to drive. Same shape of environmental gate as the
// service-worker-controlled reload spec above.
test.describe('Server-side reconciliation', () => {
  test('a set logged offline is parked, not attempted, and reaches the server on reconnect', async ({ page, context }) => {
    test.skip(!stubEnabled, STUB_DISABLED_REASON)
    // A full sign-in, two logged sets and two server round trips do not fit the
    // 30s default.
    test.setTimeout(90000)

    await page.goto('/')
    await signInDev(page)

    const name = uniqueExerciseName('Squat')
    await createExerciseWithSet(page, name, '225', '5')

    // Online baseline. This also proves the harness itself is live, so the
    // negative assertion further down cannot pass because nothing ever syncs.
    const exerciseId = await expectExerciseOnServer(name)
    await expectSetOnServer(exerciseId, 225, 5)

    await context.setOffline(true)
    await expect(page.locator('.syncIndicator--offline')).toBeVisible()

    await page.locator('.wtExerciseLogBtnCircle').click()
    await logSetInModal(page, '235', '5')
    await expectSetCount(page, name, 2)

    // PARKED: `flush()` returns early while `isOffline()`, keeping the queue
    // intact and counting no attempt. Nothing new may reach the server.
    await settleBeyondFlushDebounce(page)
    expect(await serverSetsFor(exerciseId)).toHaveLength(1)

    // Reconnect. The queue arms its own one-shot `online` listener precisely so
    // this does not have to wait for the next launch.
    await context.setOffline(false)
    await expectSetOnServer(exerciseId, 235, 5)
    await expect(page.locator('.syncIndicator--offline')).toBeHidden()
  })

  test('a set logged offline is not lost when the tab is killed — it reaches the server on the next launch', async ({ page, context }) => {
    test.skip(!stubEnabled, STUB_DISABLED_REASON)
    test.setTimeout(90000)

    await page.goto('/')
    await signInDev(page)

    const name = uniqueExerciseName('Deadlift')
    await createExerciseWithSet(page, name, '315', '3')
    const exerciseId = await expectExerciseOnServer(name)

    await context.setOffline(true)
    await expect(page.locator('.syncIndicator--offline')).toBeVisible()

    await page.locator('.wtExerciseLogBtnCircle').click()
    await logSetInModal(page, '335', '1')
    await expectSetCount(page, name, 2)

    // Still unsent, and now the tab goes away outright — `page.close()` runs no
    // beforeunload handler, so nothing gets a last chance to flush. That is the
    // real shape of the failure: iOS reclaims a backgrounded PWA, and the only
    // record of the set is what already reached IndexedDB.
    await settleBeyondFlushDebounce(page)
    expect(await serverSetsFor(exerciseId)).toHaveLength(1)
    await page.close()

    // Relaunch in a new tab of the SAME context, so localStorage and IndexedDB
    // carry over exactly as they would on a real device.
    await context.setOffline(false)
    const relaunched = await context.newPage()
    await relaunched.goto('/')
    await signInDev(relaunched)

    // The write lands with no user action. `initStores` drives both mechanisms
    // that can deliver it — `syncQueue.rehydrate()` replaying the journaled
    // descriptor, and the fetch path's union-then-push reconciliation — and the
    // guarantee under test is the outcome they exist to produce jointly: an
    // offline write is never silently dropped by a relaunch.
    await expectSetOnServer(exerciseId, 335, 1)
  })

  test('signing out wipes the journal, so the next session never uploads the previous one\'s offline set', async ({ page, context }) => {
    test.skip(!stubEnabled, STUB_DISABLED_REASON)
    test.setTimeout(90000)

    await page.goto('/')
    await signInDev(page)

    const name = uniqueExerciseName('Bench Press')
    await createExerciseWithSet(page, name, '185', '5')
    const exerciseId = await expectExerciseOnServer(name)

    await context.setOffline(true)
    await expect(page.locator('.syncIndicator--offline')).toBeVisible()

    await page.locator('.wtExerciseLogBtnCircle').click()
    await logSetInModal(page, '195', '5')
    await expectSetCount(page, name, 2)
    await settleBeyondFlushDebounce(page)
    expect(await serverSetsFor(exerciseId)).toHaveLength(1)

    // Sign out with the write still pending. `teardownSession()` runs
    // `syncQueue.clear()` (which empties AND erases the durable journal) before
    // `resetStores()`. Offline is safe here: there is no Supabase session behind
    // the dev sign-in, so `auth.signOut()` short-circuits before the network.
    await signOutViaSettings(page)
    await context.setOffline(false)

    // Positive control FIRST: the next session's writes really do reach the
    // server, so the absence asserted below is a wiped journal rather than a
    // dead channel.
    await signInDev(page)
    const control = uniqueExerciseName('Control')
    await createExerciseWithSet(page, control, '95', '5')
    await expectExerciseOnServer(control)

    // The previous session's offline set never replayed — not from the journal,
    // and not from a store that should have been reset with it.
    expect(await serverSetsFor(exerciseId)).toHaveLength(1)
    const staleSetWrites = (await stubWrites()).filter(
      w => w.table === 'sets' && w.rows.some(r => r.exercise_id === exerciseId && Number(r.weight) === 195),
    )
    expect(staleSetWrites).toHaveLength(0)
  })
})

// LIFT-1008 — the shared-device replay invariant, as the user sees it.
//
// The durable write queue journals pending writes to IndexedDB and replays them
// on the next launch. That durability MUST be scoped to the user who created it:
// signing out wipes the journal AND resets every store so the next person on a
// shared device (a gym iPad, a borrowed phone) never sees — or re-uploads — the
// previous user's sets (CLAUDE.md → "Durable write queue": "The journal is wiped
// on sign-out so a shared device never replays the previous user's writes").
// `useAuth.signOut` enforces this via `syncQueue.clear()` + `resetStores()`.
//
// This is the local half, and it runs everywhere, with or without a stub: a set
// logged by user A must not survive a sign-out into user B's fresh session on
// the same device, even across a reload (which rehydrates the stores straight
// from local storage). The server half — that the pending write is never
// uploaded either — is the third spec in the group above.
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
