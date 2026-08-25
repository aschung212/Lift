import { test, expect } from '@playwright/test'
import { expectNoA11yViolations } from './support/axe'

test.describe('Auth Screen', () => {
  test.beforeEach(async ({ page }) => {
    // Don't set onboarding-complete — auth screen shows before onboarding
    await page.goto('/')
  })

  test('shows auth screen with email form and providers', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.authLogo')).toHaveText('Lift')
    await expect(page.locator('.authTagline')).toBeVisible()

    // Email form
    await expect(page.locator('input[aria-label="Email"]')).toBeVisible()
    await expect(page.locator('input[aria-label="Password"]')).toBeVisible()
    await expect(page.locator('.authSubmitBtn')).toHaveText('Sign In')

    // Google OAuth button
    await expect(page.locator('.authProviderBtn.authGoogle')).toContainText('Continue with Google')
  })

  test('toggles between sign in and sign up modes', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })

    // Default is sign in
    await expect(page.locator('.authSubmitBtn')).toHaveText('Sign In')
    await expect(page.locator('.authModeSwitch')).toContainText("Don't have an account? Sign up")

    // Switch to sign up
    await page.locator('.authModeSwitch').click()
    await expect(page.locator('.authSubmitBtn')).toHaveText('Create Account')
    await expect(page.locator('.authModeSwitch')).toContainText('Already have an account? Sign in')

    // Switch back to sign in
    await page.locator('.authModeSwitch').click()
    await expect(page.locator('.authSubmitBtn')).toHaveText('Sign In')
  })

  test('shows dev sign-in button in dev mode', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.authDevBtn')).toContainText('Continue as Dev')
  })

  test('dev sign-in bypasses auth and loads main app', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onboarding-complete', 'true')
    })
    await page.goto('/')
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })

    await page.locator('.authDevBtn').click()
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
  })

  test('requires email and password fields for submission', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })

    // HTML5 validation: both fields have required attribute
    const emailInput = page.locator('input[aria-label="Email"]')
    const passwordInput = page.locator('input[aria-label="Password"]')

    await expect(emailInput).toHaveAttribute('required', '')
    await expect(passwordInput).toHaveAttribute('required', '')
  })

  test('email input has correct type and autocomplete', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })

    const emailInput = page.locator('input[aria-label="Email"]')
    await expect(emailInput).toHaveAttribute('type', 'email')
    await expect(emailInput).toHaveAttribute('autocomplete', 'email')

    const passwordInput = page.locator('input[aria-label="Password"]')
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
  })

  // Page-level axe scan of the fully-rendered auth screen (LIFT-1192). `bypass`
  // is disabled: this pre-auth surface intentionally ships no landmark/skip-link
  // chrome (that arrives with the authenticated app shell), so the WCAG 2.4.1
  // "bypass blocks" check doesn't apply here.
  test('auth screen has no serious/critical accessibility violations', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await expectNoA11yViolations(page, { disableRules: ['bypass'] })
  })

  test('auth screen in sign-up mode has no serious/critical accessibility violations', async ({ page }) => {
    await expect(page.locator('.authScreen')).toBeVisible({ timeout: 10000 })
    await page.locator('.authModeSwitch').click()
    await expect(page.locator('.authSubmitBtn')).toHaveText('Create Account')
    await expectNoA11yViolations(page, { disableRules: ['bypass'] })
  })
})
