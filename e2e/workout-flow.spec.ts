import { test, expect } from '@playwright/test'

// In dev mode, auth is bypassed (local-dev user).
// We skip onboarding and disable rest timer for clean test flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-complete', 'true')
    localStorage.setItem('rest-timer', 'off')
  })
  await page.goto('/')
  await expect(page.getByText('Exercise Tracker')).toBeVisible({ timeout: 10000 })
})

test.describe('Exercise CRUD', () => {
  test('creates a new exercise with name and tags', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Exercise' }).click()
    await expect(page.locator('#log-modal-title')).toBeVisible()

    await page.fill('input[placeholder="e.g. Bench Press"]', 'Squat')
    await page.fill('input[placeholder="New tag..."]', 'Legs')
    await page.locator('.wtTagAddBtn').click()
    await page.fill('input[placeholder="135"]', '225')
    await page.fill('input[placeholder="8"]', '5')
    await page.locator('.repMaxBtnCalc').click()

    // Wait for modal to close
    await expect(page.locator('.repMaxOverlay')).not.toBeVisible()

    // Verify exercise appears
    await expect(page.locator('.wtExerciseName')).toHaveText('Squat')
  })

  test('logs additional sets and shows correct count', async ({ page }) => {
    // Create an exercise
    await page.getByRole('button', { name: '+ New Exercise' }).click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Deadlift')
    await page.fill('input[placeholder="135"]', '315')
    await page.fill('input[placeholder="8"]', '3')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxOverlay')).not.toBeVisible()
    await expect(page.locator('.wtExerciseName', { hasText: 'Deadlift' })).toBeVisible()

    // Log another set via the "+ Log" button
    await page.locator('.wtExerciseLogBtn').click()
    await page.fill('input[placeholder="135"]', '335')
    await page.fill('input[placeholder="8"]', '1')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxOverlay')).not.toBeVisible()

    // Verify 2 sets (text may be in overflow-hidden container, check content)
    await expect(page.locator('.wtExerciseMeta')).toContainText('2 sets')
  })

  test('opens exercise detail modal with set history', async ({ page }) => {
    // Create exercise
    await page.getByRole('button', { name: '+ New Exercise' }).click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'OHP')
    await page.fill('input[placeholder="135"]', '95')
    await page.fill('input[placeholder="8"]', '8')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxOverlay')).not.toBeVisible()

    // Click the exercise row to open detail
    await page.locator('.wtExerciseRow').filter({ hasText: 'OHP' }).click()
    await expect(page.locator('.wtDetailTitle')).toHaveText('OHP')
    await expect(page.locator('.wtSetRow')).toBeVisible()
  })
})

test.describe('Tab Navigation', () => {
  test('switches between workout, calendar, and weight tabs', async ({ page }) => {
    await expect(page.getByText('Exercise Tracker')).toBeVisible()

    await page.getByRole('tab', { name: 'Calendar' }).click()
    await expect(page.locator('.calCard')).toBeVisible()

    await page.getByRole('tab', { name: 'Weight' }).click()
    await expect(page.locator('.bwCard')).toBeVisible()

    await page.getByRole('tab', { name: 'Workouts' }).click()
    await expect(page.getByText('Exercise Tracker')).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('opens settings and shows appearance options', async ({ page }) => {
    await page.locator('.tabBtnSettings').click()
    await expect(page.locator('.settingsSheet')).toBeVisible()
    await expect(page.getByText('Appearance')).toBeVisible()
    await expect(page.getByText('Liquid Glass')).toBeVisible()
  })
})

test.describe('Live 1RM Estimate', () => {
  test('displays estimated 1RM while entering weight and reps', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Exercise' }).click()
    await page.fill('input[placeholder="e.g. Bench Press"]', 'Bench Press')
    await page.fill('input[placeholder="135"]', '200')
    await page.fill('input[placeholder="8"]', '5')

    // Epley: 200 * (1 + 5/30) ≈ 233
    await expect(page.locator('.repMaxResult')).toBeVisible()
    await expect(page.locator('.repMaxResultLabel')).toHaveText('Estimated 1RM')
  })
})
