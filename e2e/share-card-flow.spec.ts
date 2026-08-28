import { test, expect, type Page, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The share-card generate-image path is rasterized via `modern-screenshot`,
// which needs a real browser: happy-dom cannot execute the DOM→SVG→canvas
// pipeline, so the unit tests on shareImage.ts helpers (filenames, watermark,
// preview sizes) never exercise the actual render. A regression in card
// layout, theme-var snapshotting, or the modern-screenshot serialization would
// produce a broken/blank export with no failing test (LIFT-1191).
//
// These E2E tests drive the real UI to the SharePickerSheet, then use the
// "Save image" action — which always routes through `downloadCard` →
// `downloadBlob` (never `navigator.share`, so it's deterministic in a headless
// browser) — and assert a genuine, non-empty PNG lands on disk.

// The 8-byte PNG file signature. A produced file that starts with these bytes
// is a real PNG, not a truncated/blank/HTML-error export.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-complete', 'true')
    localStorage.setItem('rest-timer', 'off')
    // fresh-start surfaces the CTA we use to create the first exercise + set,
    // and clears sample data so today's summary reflects only what we log.
    localStorage.setItem('fresh-start', 'true')
  })
  await page.goto('/')
  await page.locator('.authDevBtn').click({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
})

/**
 * Create an exercise and log a single heavy set so that (a) the "Finish
 * workout" affordance appears (setsLoggedToday > 0) and (b) the resulting
 * summary has a best set — giving the picker a full deck of eligible cards.
 */
async function logASet(page: Page) {
  await page.locator('.wtFreshStartCta').click()
  await expect(page.locator('#log-modal-title')).toBeVisible()
  await page.fill('input[placeholder="e.g. Bench Press"]', 'Bench Press')
  await page.fill('[aria-label="Weight"]', '225')
  await page.fill('[aria-label="Reps"]', '5')
  await page.locator('.repMaxBtnCalc').click()
  await page.locator('.repMaxBtnClose').click()
  await expect(page.locator('.wtExerciseName', { hasText: 'Bench Press' })).toBeVisible()
}

/** Finish the workout and open the share picker from the summary view. */
async function openSharePicker(page: Page) {
  await page.locator('.wtFinishWorkoutBtn').click()
  await expect(page.locator('.wcOverlay')).toBeVisible()
  await page.locator('.wcShare').click()
  await expect(page.locator('.spOverlay')).toBeVisible()
  // Thumbnails render the card components (the same DOM the exporter
  // rasterizes) — at least one must paint before we can export.
  await expect(page.locator('.spThumb').first()).toBeVisible()
}

/**
 * Click a "Save image" action, capture the resulting download, and assert it
 * is a real, non-empty PNG produced by the modern-screenshot pipeline.
 */
async function saveAndAssertPng(page: Page, saveButton: Locator) {
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 })
  await saveButton.click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^lift-.*\.png$/)

  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = readFileSync(path)
  // A blank/broken export would either not download or land as a tiny/HTML
  // blob. A genuinely rendered 1080px card is comfortably over 1KB.
  expect(bytes.length).toBeGreaterThan(1000)
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
}

test.describe('Share card generation', () => {
  test('renders and saves a square card as a non-empty PNG', async ({ page }) => {
    await logASet(page)
    await openSharePicker(page)

    // "Post" (square) is the default format. Select the first card explicitly
    // to exercise the selection handler, then export it.
    await page.locator('.spThumb').first().click()
    await saveAndAssertPng(page, page.locator('.spActionSecondary'))
  })

  test('renders and saves a story card as a non-empty PNG', async ({ page }) => {
    await logASet(page)
    await openSharePicker(page)

    // Toggle to the taller 9:16 story format — a distinct render size + set of
    // card components from the square deck.
    await page.getByRole('tab', { name: 'Story' }).click()
    await expect(page.locator('.spThumbRowStory')).toBeVisible()
    await expect(page.locator('.spThumb').first()).toBeVisible()

    await saveAndAssertPng(page, page.locator('.spActionSecondary'))
  })
})
