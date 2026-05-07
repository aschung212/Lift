import { test, expect } from '@playwright/test'

test.describe('Bodyweight Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('onboarding-complete', 'true')
      localStorage.setItem('rest-timer', 'off')
    })
    await page.goto('/')
    // Sign in via dev mode
    await page.locator('.authDevBtn').click({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })

    // Navigate to Weight tab
    await page.getByRole('tab', { name: 'Weight' }).click()
    await expect(page.locator('.bwCard')).toBeVisible()
  })

  // Helper to scope selectors within the bodyweight card
  function bw(page: import('@playwright/test').Page) {
    return page.locator('.bwCard')
  }

  test('shows empty state when no entries exist', async ({ page }) => {
    await expect(bw(page).locator('.wtEmpty')).toBeVisible()
  })

  test('adds a bodyweight entry via modal', async ({ page }) => {
    bw(page).locator('.wtLogBtn').click()
    await expect(page.locator('#bw-modal-title')).toBeVisible()

    // Fill in weight
    await page.locator('.repMaxModal input[type="number"]').fill('185')
    await page.locator('.repMaxBtnCalc').click()

    // Modal closes and entry appears
    await expect(page.locator('.repMaxModal')).not.toBeVisible()
    await expect(bw(page).locator('.wtSetRow')).toBeVisible()
    await expect(bw(page).locator('.wtSetRow')).toContainText('185')
  })

  test('shows current weight after adding entry', async ({ page }) => {
    bw(page).locator('.wtLogBtn').click()
    await page.locator('.repMaxModal input[type="number"]').fill('180')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    await expect(bw(page).locator('.bwCurrentValue')).toContainText('180')
  })

  test('adds multiple entries and shows delta', async ({ page }) => {
    // Add first entry
    bw(page).locator('.wtLogBtn').click()
    await page.locator('.repMaxModal input[type="number"]').fill('185')
    // Set date to yesterday to ensure ordering
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0]
    await page.locator('.repMaxModal input[type="date"]').fill(dateStr)
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    // Add second entry (today, lighter)
    bw(page).locator('.wtLogBtn').click()
    await expect(page.locator('.repMaxModal')).toBeVisible()
    await page.locator('.repMaxModal input[type="number"]').fill('183')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    // Should show 2 entries
    await expect(bw(page).locator('.wtSetRow')).toHaveCount(2)

    // Delta should be visible on an entry
    await expect(bw(page).locator('.bwDelta').first()).toBeVisible()
  })

  test('switches period filters', async ({ page }) => {
    // Add an entry first so period buttons are meaningful
    bw(page).locator('.wtLogBtn').click()
    await page.locator('.repMaxModal input[type="number"]').fill('180')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    // Check period buttons exist
    const periodBtns = bw(page).locator('.bwPeriodBtn')
    await expect(periodBtns).toHaveCount(4)

    // Click each period button and verify it becomes active
    for (const label of ['7d', '30d', '90d', '1y']) {
      await bw(page).locator('.bwPeriodBtn', { hasText: label }).click()
      await expect(bw(page).locator('.bwPeriodBtn.active', { hasText: label })).toBeVisible()
    }
  })

  test('deletes a bodyweight entry', async ({ page }) => {
    // Add an entry
    bw(page).locator('.wtLogBtn').click()
    await page.locator('.repMaxModal input[type="number"]').fill('175')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()
    await expect(bw(page).locator('.wtSetRow')).toBeVisible()

    // Click the entry to reveal actions
    await bw(page).locator('.wtSetRow').click()
    await expect(bw(page).locator('.wtSetActions')).toBeVisible()

    // Click delete
    await bw(page).locator('.wtSetBtnDel').click()

    // Entry should be gone
    await expect(bw(page).locator('.wtSetRow')).not.toBeVisible()
    await expect(bw(page).locator('.wtEmpty')).toBeVisible()
  })

  test('edits a bodyweight entry', async ({ page }) => {
    // Add an entry
    bw(page).locator('.wtLogBtn').click()
    await page.locator('.repMaxModal input[type="number"]').fill('190')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    // Click entry to reveal actions, then click edit
    await bw(page).locator('.wtSetRow').click()
    await expect(bw(page).locator('.wtSetActions')).toBeVisible()
    await bw(page).locator('.wtSetBtn').first().click()

    // Modal opens in edit mode
    await expect(page.locator('.repMaxModal')).toBeVisible()

    // Change weight
    await page.locator('.repMaxModal input[type="number"]').fill('188')
    await page.locator('.repMaxBtnCalc').click()
    await expect(page.locator('.repMaxModal')).not.toBeVisible()

    // Verify updated weight
    await expect(bw(page).locator('.wtSetRow')).toContainText('188')
  })
})
