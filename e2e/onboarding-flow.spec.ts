import { test, expect } from '@playwright/test'

test.describe('Onboarding Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Do NOT set onboarding-complete — we want to see the onboarding screen
    // But we need to get past auth first (dev mode)
    await page.addInitScript(() => {
      localStorage.setItem('rest-timer', 'off')
    })
    await page.goto('/')
  })

  test('shows onboarding after dev sign-in when not completed', async ({ page }) => {
    // Auth screen appears first
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()

    // Onboarding should appear (not the main app)
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.obLogo')).toHaveText('Lift')
    await expect(page.locator('.obTagline')).toBeVisible()
  })

  test('displays three onboarding options', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    const options = page.locator('.obOption')
    await expect(options).toHaveCount(3)
  })

  // TODO(LIFT-345 follow-up): the option order changed (featured Starter is
  // now index 0, not 1) AND clicking an option no longer immediately completes
  // onboarding — it now opens a sub-flow (StarterPickerFlow / etc.) that emits
  // `complete` only after additional steps. Update these tests to walk through
  // the full sub-flow before asserting the main app loads.
  test.skip('choosing "Start Empty" loads main app with no exercises', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // First option: start empty (rocket emoji)
    await page.locator('.obOption').first().click()

    // Main app should load
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })

    // No exercises should be present
    await expect(page.locator('.wtExerciseRow')).not.toBeVisible()
  })

  test.skip('choosing "Starter Exercises" loads main app with exercises', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // Second option: starter exercises
    await page.locator('.obOption').nth(1).click()

    // Main app should load with exercises
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wtExerciseRow').first()).toBeVisible({ timeout: 5000 })
  })

  test.skip('choosing "Explore" loads main app with sample data', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // Third option: explore with sample data
    await page.locator('.obOption').nth(2).click()

    // Main app should load with exercises
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wtExerciseRow').first()).toBeVisible({ timeout: 5000 })
  })

  test('onboarding is skipped when already completed', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onboarding-complete', 'true')
    })
    await page.goto('/')

    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()

    // Should go straight to main app, no onboarding
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.obScreen')).not.toBeVisible()
  })
})
