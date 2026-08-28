import { test, expect } from '@playwright/test'

// In dev mode, we sign in via the dev button.
// We skip onboarding and disable rest timer for clean test flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-complete', 'true')
    localStorage.setItem('rest-timer', 'off')
    // wtFreshStartCta only renders when this flag is set (mirrors the
    // 'clear sample data' Settings action). Tests below click it as the
    // entry point for Exercise CRUD and Live 1RM.
    localStorage.setItem('fresh-start', 'true')
  })
  await page.goto('/')
  // Sign in via dev mode
  await page.locator('.authDevBtn').click({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
})

test.describe('Exercise CRUD', () => {
  test('creates a new exercise via fresh-start CTA with name and tags', async ({ page }) => {
    // Fresh-start CTA is shown when no exercises exist
    await page.locator('.wtFreshStartCta').click()
    await expect(page.locator('#log-modal-title')).toBeVisible()

    // Fill exercise name
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Squat')

    // Add a tag via the inline tag add button. Target the accessible name, not
    // .wtTagAddChip — the new-exercise form has TWO inline add chips sharing
    // that class (tags and gym, #984), so the bare class is a strict-mode
    // violation. The aria-label is unique and survives new pickers.
    await page.getByRole('button', { name: 'Add tag' }).click()
    await page.fill('[aria-label="New tag name"]', 'Legs')
    await page.keyboard.press('Enter')

    // Fill weight and reps
    await page.fill('[aria-label="Weight"]', '225')
    await page.fill('[aria-label="Reps"]', '5')
    await page.locator('.repMaxBtnCalc').click()

    // Modal stays open after save — close it
    await page.locator('.repMaxBtnClose').click()

    // Verify exercise appears in the list
    await expect(page.locator('.wtExerciseName')).toHaveText('Squat')
  })

  test('logs additional sets and shows in detail modal', async ({ page }) => {
    // Create first exercise via fresh-start CTA
    await page.locator('.wtFreshStartCta').click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Deadlift')
    await page.fill('[aria-label="Weight"]', '315')
    await page.fill('[aria-label="Reps"]', '3')
    await page.locator('.repMaxBtnCalc').click()
    await page.locator('.repMaxBtnClose').click()
    await expect(page.locator('.wtExerciseName', { hasText: 'Deadlift' })).toBeVisible()

    // Log another set via the circular "+" log button on the exercise row
    await page.locator('.wtExerciseLogBtnCircle').click()
    await expect(page.locator('#log-modal-title')).toBeVisible()
    await page.fill('[aria-label="Weight"]', '335')
    await page.fill('[aria-label="Reps"]', '1')
    await page.locator('.repMaxBtnCalc').click()
    await page.locator('.repMaxBtnClose').click()

    // Open detail modal by clicking the exercise row
    await page.locator('.wtExerciseRow').filter({ hasText: 'Deadlift' }).click()
    await expect(page.locator('.wtDetailTitle')).toHaveText('Deadlift')
    await expect(page.locator('.wtSetRow')).toHaveCount(2)
  })

  test('creates a second exercise via the top-bar "+"', async ({ page }) => {
    // Create first exercise to clear fresh-start state. Save requires a set
    // (weight + reps) — without it the modal transitions to a different
    // state whose close button isn't .repMaxBtnClose, so mirror the
    // first-test flow which fills weight + reps before saving.
    await page.locator('.wtFreshStartCta').click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'OHP')
    await page.fill('[aria-label="Weight"]', '135')
    await page.fill('[aria-label="Reps"]', '5')
    await page.locator('.repMaxBtnCalc').click()
    await page.locator('.repMaxBtnClose').click()
    await expect(page.locator('.wtExerciseName', { hasText: 'OHP' })).toBeVisible()

    // The top-bar "+" now opens the New Exercise modal directly (no picker hop).
    await page.locator('.topBarPlusBtn').click()
    await expect(page.locator('#log-modal-title')).toHaveText('New Exercise')

    // Fill in second exercise
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Bench Press')
    await page.fill('[aria-label="Weight"]', '200')
    await page.fill('[aria-label="Reps"]', '5')
    await page.locator('.repMaxBtnCalc').click()
    await page.locator('.repMaxBtnClose').click()

    // Verify both exercises appear
    await expect(page.locator('.wtExerciseName', { hasText: 'OHP' })).toBeVisible()
    await expect(page.locator('.wtExerciseName', { hasText: 'Bench Press' })).toBeVisible()
  })
})

test.describe('Tab Navigation', () => {
  test('switches between workout, calendar, and weight tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible()

    await page.getByRole('tab', { name: 'Calendar' }).click()
    await expect(page.locator('.calCard')).toBeVisible()

    await page.getByRole('tab', { name: 'Weight' }).click()
    await expect(page.locator('.bwCard')).toBeVisible()

    await page.getByRole('tab', { name: 'Workouts' }).click()
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('opens settings and shows appearance options with theme grid', async ({ page }) => {
    await page.locator('.settingsGearBtn').click()
    await expect(page.locator('.settingsSheet')).toBeVisible()
    await expect(page.getByText('Appearance')).toBeVisible()
    // Verify theme grid is rendered with actual theme buttons
    await expect(page.locator('.settingsThemeGrid')).toBeVisible()
    // Check that at least one theme preview button exists with a known theme label
    await expect(page.locator('.themePreview').first()).toBeVisible()
  })
})

test.describe('Live 1RM Estimate', () => {
  test('displays estimated 1RM while entering weight and reps', async ({ page }) => {
    // Open the new exercise modal via fresh-start CTA
    await page.locator('.wtFreshStartCta').click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Bench Press')
    await page.fill('[aria-label="Weight"]', '200')
    await page.fill('[aria-label="Reps"]', '5')

    // Epley: 200 * (1 + 5/30) ≈ 233
    await expect(page.locator('.repMaxResult')).toBeVisible()
    await expect(page.locator('.repMaxResultLabel')).toContainText('Estimated 1RM')
  })
})
