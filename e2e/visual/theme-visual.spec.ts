import { test, expect, type Page } from '@playwright/test'

/**
 * Visual-regression snapshots for the 10 themes across light + dark (LIFT-664).
 *
 * The structural theme tests (`cssRegression.test.ts`, `themeContrast.test.ts`)
 * verify property placement and WCAG ratios, but neither catches *visual*
 * breakage — a gradient rendering wrong, glass-morphism layering inverting, or
 * a per-theme layout shift. These snapshots diff the actual painted pixels of
 * key screens per theme/mode.
 *
 * Snapshots are OS/browser-dependent: Playwright suffixes each baseline with the
 * platform (`-linux`, `-darwin`), so baselines generated on macOS never collide
 * with the Linux baselines the CI diff runs against. Generate/refresh Linux
 * baselines through the pinned Playwright container (see
 * `.github/workflows/visual-regression.yml`) — a local `npm run test:visual:update`
 * only writes `-darwin` baselines, which CI ignores.
 */

// Mirrors the theme IDs in src/lib/themes.ts (kept as a literal so the e2e
// suite stays decoupled from the app build graph). If a theme is added/renamed
// there, add it here — the count is asserted below so drift fails loudly.
const THEME_IDS = [
  'eternal',
  'pearl',
  'midnight',
  'fire',
  'water',
  'earth',
  'luck',
  'amethyst',
  'air',
  'love',
] as const

const MODES = ['light', 'dark'] as const

/**
 * Seed a deterministic session (theme, mode, and a fixed set of exercises)
 * into localStorage before the app boots, then sign in via the dev button.
 * Dates are anchored to "today" so recency ordering and relative-date labels
 * are stable regardless of when the snapshot runs.
 */
async function bootThemedApp(page: Page, theme: string, mode: string): Promise<void> {
  await page.addInitScript(
    ({ theme, mode }) => {
      localStorage.setItem('onboarding-complete', 'true')
      localStorage.setItem('rest-timer', 'off')
      localStorage.setItem('weight-unit', 'lbs')
      localStorage.setItem('app-theme', theme)
      localStorage.setItem('app-mode', mode)

      const t = new Date()
      const y = t.getFullYear()
      const m = String(t.getMonth() + 1).padStart(2, '0')
      const d = String(t.getDate()).padStart(2, '0')
      const today = `${y}-${m}-${d}`
      const e1rm = (w: number, r: number) => Math.round(w * (1 + r / 30))

      const exercises = [
        {
          id: 'ex-bench',
          name: 'Bench Press',
          tags: ['Chest'],
          sets: [
            { id: 's-b1', date: `${today}T12:00:00.000Z`, weight: 185, reps: 5, estimated1RM: e1rm(185, 5) },
            { id: 's-b2', date: `${today}T12:05:00.000Z`, weight: 195, reps: 3, estimated1RM: e1rm(195, 3) },
          ],
        },
        {
          id: 'ex-squat',
          name: 'Back Squat',
          tags: ['Legs'],
          sets: [
            { id: 's-s1', date: `${today}T13:00:00.000Z`, weight: 225, reps: 5, estimated1RM: e1rm(225, 5) },
          ],
        },
        {
          id: 'ex-dead',
          name: 'Deadlift',
          tags: ['Back'],
          sets: [
            { id: 's-d1', date: `${today}T14:00:00.000Z`, weight: 315, reps: 3, estimated1RM: e1rm(315, 3) },
          ],
        },
      ]
      localStorage.setItem('workout-exercises', JSON.stringify(exercises))
    },
    { theme, mode }
  )

  await page.goto('/')
  await page.locator('.authDevBtn').click({ timeout: 10000 })
  await expect(page.getByRole('heading', { name: 'Workouts', level: 1 })).toBeVisible({ timeout: 10000 })
  // Confirm the seeded theme/mode actually landed on the root element before we
  // paint — otherwise a snapshot could capture the pre-hydration default.
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
}

test('theme id list matches the app (drift guard)', () => {
  expect(THEME_IDS).toHaveLength(10)
})

for (const mode of MODES) {
  for (const theme of THEME_IDS) {
    test.describe(`theme: ${theme} (${mode})`, () => {
      test('workouts list', async ({ page }) => {
        await bootThemedApp(page, theme, mode)
        await expect(page.locator('.wtExerciseRow').first()).toBeVisible()
        await expect(page).toHaveScreenshot(`workouts-${theme}-${mode}.png`)
      })

      test('settings appearance / theme grid', async ({ page }) => {
        await bootThemedApp(page, theme, mode)
        await page.locator('.settingsGearBtn').click()
        await expect(page.locator('.settingsSheet')).toBeVisible()
        await expect(page.locator('.settingsThemeGrid')).toBeVisible()
        await expect(page.locator('.themePreview').first()).toBeVisible()
        await expect(page).toHaveScreenshot(`settings-appearance-${theme}-${mode}.png`)
      })
    })
  }
}
