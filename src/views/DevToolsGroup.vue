<template>
  <div class="settingsGroup">
    <div class="settingsHeader">Dev Tools</div>
    <div class="devToolsGrid">
      <button class="devBtn" @click="devResetOnboarding">Reset Onboarding</button>
      <button class="devBtn" @click="devSeedProgression(12400)">Seed 12k XP</button>
      <button class="devBtn" @click="devSeedProgression(80000)">Seed 80k XP</button>
      <button class="devBtn" @click="devAddXP(5000)">+5,000 XP</button>
      <button class="devBtn" @click="devRunMigration">Run Migration</button>
      <button class="devBtn devBtnDanger" @click="devClearAll">Clear All Data</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Dev-only Settings group: XP seeding, onboarding reset, migration re-run and
// a full local wipe. SettingsSheet lazily imports this component ONLY when the
// build sets `import.meta.env.DEV` (the Vite dev server, including native live
// reload via CAPACITOR_DEV_URL) or VITE_E2E (the CI e2e build), so the whole
// group — and its chunk — is physically absent from a production bundle. That
// is the LIFT-1123 shape that keeps the dev sign-in button out of AuthScreen; an
// inline `v-if` would compile into SettingsSheet's render function and ship
// in every bundle, merely hidden.
//
// It used to be exactly that: an inline group behind a hostname test
// (localhost / 127. / 192.168. / 10.). The bundled Capacitor app is served
// from capacitor://localhost, so every native install tripped it, and the
// first physical-iPhone run of the App Store build rendered "Seed 80k XP" and
// "Clear All Data" as a normal settings group (#1425). A hostname says where
// the page came from, not whether a dev server is behind it — the gate is the
// build mode, and prodBundleGuard.test.ts + scripts/check-no-dev-surface.js
// pin this group's markers out of dist/.
//
// Every reload below is behind an explicit tap, which is why this file is on
// the USER_INITIATED allowlist of the guardedReload invariant (#1155).
import type { ThemeId } from '../lib/themes'
import { useProgressionStore } from '../stores/progression'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { markMigrated, clearMigrationFlag, computeRetroactiveXP } from '../lib/xpMigration'
import { clearIDB } from '../lib/durableStorage'

const progressionStore = useProgressionStore()
const workoutStore = useWorkoutStore()
const bodyweightStore = useBodyweightStore()

function devResetOnboarding() {
  localStorage.removeItem('onboarding-complete')
  localStorage.removeItem('user-progression')
  location.reload()
}

function devSeedProgression(xp: number) {
  const starter = progressionStore.starterTheme || 'fire' as ThemeId
  progressionStore.totalXP = xp
  progressionStore.streakWeeks = 8
  progressionStore.weeklyTarget = 4
  progressionStore.showProgression = true
  progressionStore.progressionEnabled = true
  if (!progressionStore.starterTheme) {
    progressionStore.starterTheme = starter
  }
  progressionStore.streakHistory = [{ weekStart: '2026-03-30', streakCount: 8, weeklyTarget: 4, combinedMultiplier: 1.8 }]
  progressionStore.unlockedThemes = [{ id: 'pearl', unlockedAt: new Date().toISOString() }]
  if (!progressionStore.unlockedThemes.some(t => t.id === starter)) {
    progressionStore.unlockedThemes.push({ id: starter, unlockedAt: new Date().toISOString() })
  }
  progressionStore.checkUnlocks()
  progressionStore._persist()
}

function devAddXP(amount: number) {
  progressionStore.totalXP += amount
  progressionStore.checkUnlocks()
  progressionStore._persist()
}

function devRunMigration() {
  clearMigrationFlag()
  const result = computeRetroactiveXP(workoutStore.exercises, bodyweightStore.entries)
  progressionStore.totalXP = result.totalXP
  progressionStore.xpPerSet = result.xpPerSet
  progressionStore.bodyweightXPDates = result.bodyweightXPDates
  progressionStore.checkUnlocks()
  progressionStore._persist()
  markMigrated()
}

async function devClearAll() {
  localStorage.clear()
  await clearIDB()
  location.reload()
}
</script>
