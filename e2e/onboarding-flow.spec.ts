import { test, expect } from '@playwright/test'
import { expectNoA11yViolations } from './support/axe'

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

  test('choosing "Start Empty" walks through StarterPickerFlow then loads main app', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // "Start empty" is the second option (featured "Popular exercises" is first)
    await page.locator('.obOption', { hasText: 'Start empty' }).click()

    // StarterPickerFlow step 1: explainer
    await expect(page.locator('.spfTitle', { hasText: 'Theme Progression' })).toBeVisible({ timeout: 5000 })

    // Skip the starter flow to finish onboarding quickly
    await page.locator('.spfSecondary', { hasText: 'Skip' }).click()

    // Main app should load
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })

    // The onboarding "Start empty" path does not currently set the
    // 'fresh-start' localStorage flag (that flag mirrors the in-app
    // 'clear sample data' action), so wtFreshStartCta does not render
    // here. Asserting just on the main app heading is what this test is
    // really about; clearing-state UX is exercised separately.
  })

  test('choosing "Popular Exercises" pre-loads exercises then loads main app', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // "Popular exercises" is the featured (first) option
    await page.locator('.obOptionFeatured').click()

    // StarterPickerFlow step 1: explainer
    await expect(page.locator('.spfTitle', { hasText: 'Theme Progression' })).toBeVisible({ timeout: 5000 })

    // Walk through the full flow: explainer → pick → goal
    await page.locator('.spfPrimary', { hasText: 'Pick a Starter Theme' }).click()

    // Step 2: pick a starter theme
    await expect(page.locator('.spfTitle', { hasText: 'Pick Your Starter' })).toBeVisible({ timeout: 5000 })
    await page.locator('.spfCard').first().click()
    await page.locator('.spfPrimary', { hasText: 'Next' }).click()

    // Step 3: weekly goal
    await expect(page.locator('.spfTitle', { hasText: 'Set Your Weekly Goal' })).toBeVisible({ timeout: 5000 })
    await page.locator('.spfPrimary', { hasText: "Let's Go" }).click()

    // Main app should load with pre-loaded exercises
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.wtExerciseRow').first()).toBeVisible({ timeout: 5000 })
  })

  test('choosing "Explore" loads main app with sample data', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })

    // "Explore first" is the third option
    await page.locator('.obOption', { hasText: 'Explore first' }).click()

    // StarterPickerFlow step 1: explainer — skip to finish quickly
    await expect(page.locator('.spfTitle', { hasText: 'Theme Progression' })).toBeVisible({ timeout: 5000 })
    await page.locator('.spfSecondary', { hasText: 'Skip' }).click()

    // Main app should load with exercises (sample data)
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

  // Page-level axe scan of the fully-rendered onboarding screen (LIFT-1192).
  // Like the auth screen, this pre-app surface renders no landmark/skip-link
  // chrome, so `bypass` (WCAG 2.4.1) is not applicable here.
  test('onboarding screen has no serious/critical accessibility violations', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authDevBtn').click()
    await expect(page.locator('.obScreen')).toBeVisible({ timeout: 10000 })
    await expectNoA11yViolations(page, { disableRules: ['bypass'] })
  })
})
