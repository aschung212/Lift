import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// CSV import lives in Settings → Data → Import. It exercises the full
// file-upload → parse → store hydration → timeline render path that the
// csvImport unit tests (parse-only) don't cover.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-complete', 'true')
    localStorage.setItem('rest-timer', 'off')
    // fresh-start clears sample data so the only exercises on the Workouts
    // timeline afterward are the ones we import.
    localStorage.setItem('fresh-start', 'true')
  })
  await page.goto('/')
  await page.locator('.authDevBtn').click({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
})

/**
 * Open Settings and drive a CSV file through the hidden import <input>.
 * Uses setInputFiles directly (rather than clicking the button, which opens
 * a native OS picker Playwright can't drive).
 */
async function importFixture(page: Page, file: string) {
  await page.locator('.settingsGearBtn').click()
  await expect(page.locator('.settingsSheet')).toBeVisible()
  await page.locator('.hiddenFileInput').setInputFiles(join(fixturesDir, file))
}

/**
 * Close the settings sheet. Escape is handled on the overlay div, so press it
 * on the sheet element (bubbles up) rather than page-level, where focus may
 * sit on document.body after interacting with the file input.
 */
async function closeSettings(page: Page) {
  await page.locator('.settingsSheet').press('Escape')
  await expect(page.locator('.settingsSheet')).toBeHidden()
}

test.describe('CSV Import', () => {
  test('imports a Strong export and renders exercises on the timeline', async ({ page }) => {
    await importFixture(page, 'strong.csv')

    const result = page.locator('.settingsImportSuccess')
    await expect(result).toBeVisible()
    await expect(result).toContainText('2 exercises')
    await expect(result).toContainText('3 sets')
    await expect(result).toContainText('strong')

    // Confirm the imported exercises hydrated the store and render on the
    // Workouts timeline once settings is dismissed.
    await closeSettings(page)
    await expect(page.locator('.wtExerciseName', { hasText: 'Bench Press' })).toBeVisible()
    await expect(page.locator('.wtExerciseName', { hasText: 'Squat' })).toBeVisible()
  })

  test('imports a Hevy export (kg→lbs) and renders exercises', async ({ page }) => {
    await importFixture(page, 'hevy.csv')

    const result = page.locator('.settingsImportSuccess')
    await expect(result).toBeVisible()
    await expect(result).toContainText('2 exercises')
    await expect(result).toContainText('2 sets')
    await expect(result).toContainText('hevy')

    await closeSettings(page)
    await expect(page.locator('.wtExerciseName', { hasText: 'Bench Press' })).toBeVisible()
    await expect(page.locator('.wtExerciseName', { hasText: 'Squat' })).toBeVisible()
  })

  test('imports a Lift export with tags and renders exercises', async ({ page }) => {
    await importFixture(page, 'lift.csv')

    const result = page.locator('.settingsImportSuccess')
    await expect(result).toBeVisible()
    await expect(result).toContainText('2 exercises')
    await expect(result).toContainText('3 sets')
    await expect(result).toContainText('lift')

    await closeSettings(page)
    await expect(page.locator('.wtExerciseName', { hasText: 'Bench Press' })).toBeVisible()
    // Lift format carries tags — the imported Bench Press exercise surfaces them.
    await expect(page.locator('.wtExerciseTag', { hasText: 'Push' })).toBeVisible()
  })

  test('rejects an unrecognized CSV format with an error and imports nothing', async ({ page }) => {
    await importFixture(page, 'garbage.csv')

    const error = page.locator('.settingsImportError')
    await expect(error).toBeVisible()
    await expect(error).toContainText('Unrecognized format')

    await closeSettings(page)
    // Nothing imported — the fresh-start CTA (shown when no exercises exist)
    // is still present.
    await expect(page.locator('.wtFreshStartCta')).toBeVisible()
    await expect(page.locator('.wtExerciseName')).toHaveCount(0)
  })
})
