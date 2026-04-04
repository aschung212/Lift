<template>
  <div class="obScreen">
    <div class="obCard">
      <!-- Step 1: Setup path -->
      <template v-if="step === 'setup'">
        <div class="obLogo">Lift</div>
        <p class="obTagline">How would you like to get started?</p>

        <div class="obOptions">
          <button class="obOption" @click="chooseEmpty" aria-label="Start Empty — Add your own exercises from scratch">
            <span class="obOptionIcon">🚀</span>
            <span class="obOptionText">
              <strong>Start Empty</strong>
              <span>Add your own exercises from scratch</span>
            </span>
          </button>

          <button class="obOption" @click="chooseStarter" aria-label="Popular Exercises — Pre-load 6 common lifts with tags">
            <span class="obOptionIcon">💪</span>
            <span class="obOptionText">
              <strong>Popular Exercises</strong>
              <span>Pre-load 6 common lifts with tags</span>
            </span>
          </button>

          <button class="obOption" @click="chooseExplore" aria-label="Explore First — See the app with sample data, clear it when ready">
            <span class="obOptionIcon">👀</span>
            <span class="obOptionText">
              <strong>Explore First</strong>
              <span>See the app with sample data, clear it when ready</span>
            </span>
          </button>
        </div>
      </template>

      <!-- Step 2: Starter theme pick -->
      <!-- Step 2: Progression explainer -->
      <template v-else-if="step === 'explainer'">
        <div class="obLogo">Lift</div>
        <p class="obTagline">Lift has a theme progression system.</p>

        <div class="obExplainer">
          <div class="obExplainerRow">Every set you log earns XP</div>
          <div class="obExplainerRow">Hit PRs for bonus multipliers</div>
          <div class="obExplainerRow">Earn enough XP to unlock new themes</div>
          <div class="obExplainerRow">Build streaks for even more XP</div>
        </div>

        <button class="obStarterConfirm" @click="step = 'starter'">Pick a Starter Theme</button>
        <button class="obStarterSkip" @click="skipStarter">Skip — I'll use the defaults</button>
      </template>

      <!-- Step 3: Starter pick -->
      <template v-else-if="step === 'starter'">
        <div class="obLogo">Lift</div>
        <p class="obTagline">Try all three freely until you log your first set. Then your choice locks in.</p>

        <div class="obStarterGrid">
          <button
            v-for="s in STARTER_THEMES"
            :key="s.id"
            :class="['obStarterCard', { selected: selectedStarter === s.id }]"
            @click="selectedStarter = s.id"
          >
            <span
              class="obStarterDot"
              :style="{ background: 'linear-gradient(135deg, ' + s.accent + ', ' + s.bg + ')' }"
            >
              <svg v-if="s.id === 'fire'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 23c-4.97 0-8-3.03-8-7 0-2.5 1.5-5 3-6.5.5-.5 1.37-.18 1.37.54 0 1.3.6 2.46 1.63 3.2.2.14.46-.05.38-.28-.5-1.46-.63-3.1-.08-4.96C11.5 4.5 14 2 16 1c.4-.2.82.18.68.6C15.5 5.5 17 7 18 8.5c2 3 2 5 2 6.5 0 3.97-3.03 8-8 8z"/></svg>
              <svg v-else-if="s.id === 'water'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M2 15c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 19c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 11c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              <svg v-else-if="s.id === 'luck'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3C12 3 9 6 9 8.5c0 1.4.7 2.6 1.8 3.2L12 12l1.2-.3C14.3 11.1 15 9.9 15 8.5 15 6 12 3 12 3z"/><path d="M21 12c0 0-3-3-5.5-3-1.4 0-2.6.7-3.2 1.8L12 12l.3 1.2c.6 1.1 1.8 1.8 3.2 1.8C18 15 21 12 21 12z"/><path d="M12 21c0 0 3-3 3-5.5 0-1.4-.7-2.6-1.8-3.2L12 12l-1.2.3C9.7 12.9 9 14.1 9 15.5 9 18 12 21 12 21z"/><path d="M3 12c0 0 3 3 5.5 3 1.4 0 2.6-.7 3.2-1.8L12 12l-.3-1.2C11.1 9.7 9.9 9 8.5 9 6 9 3 12 3 12z"/></svg>
            </span>
            <span class="obStarterLabel">{{ s.label }}</span>
          </button>
        </div>

        <p class="obStarterWarning">This choice is semi-permanent. You can change it later, but your progression will reset.</p>
        <button class="obStarterConfirm" :disabled="!selectedStarter" @click="confirmStarter">Choose {{ selectedStarter ? STARTER_THEMES.find(s => s.id === selectedStarter)?.label : '' }}</button>
        <button class="obStarterSkip" @click="skipStarter">Skip — I'll just use the default</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { useProgressionStore } from '../stores/progression'
import { useTheme, THEME_PREVIEWS, type ThemeId } from '../composables/useTheme'

const emit = defineEmits<{ complete: [] }>()
const workoutStore = useWorkoutStore()
const bwStore = useBodyweightStore()
const progressionStore = useProgressionStore()

const step = ref<'setup' | 'explainer' | 'starter'>('setup')
const selectedStarter = ref<ThemeId | null>(null)
let pendingSampleData = false

const STARTER_THEMES = [
  { id: 'fire' as ThemeId, label: 'Intensity', accent: THEME_PREVIEWS.fire.dark.accent, bg: THEME_PREVIEWS.fire.dark.bg },
  { id: 'water' as ThemeId, label: 'Flow', accent: THEME_PREVIEWS.water.dark.accent, bg: THEME_PREVIEWS.water.dark.bg },
  { id: 'luck' as ThemeId, label: 'Luck', accent: THEME_PREVIEWS.luck.dark.accent, bg: THEME_PREVIEWS.luck.dark.bg },
]

const STARTER_EXERCISES = [
  { name: 'Bench Press', tags: ['Push', 'Chest'] },
  { name: 'Squat', tags: ['Legs'] },
  { name: 'Deadlift', tags: ['Pull', 'Legs'] },
  { name: 'Overhead Press', tags: ['Push', 'Shoulders'] },
  { name: 'Barbell Row', tags: ['Pull', 'Back'] },
  { name: 'Pull-ups', tags: ['Pull', 'Back'] },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const SAMPLE_SETS = [
  // Bench Press — ~365 days. Multiple sets per session, irregular schedule,
  // plateaus, deloads, bad days, missed weeks (vacation ~220 days ago)
  { exercise: 'Bench Press', sets: [
    // Beginner phase — learning form, conservative
    { weight: 95, reps: 8, date: daysAgo(358) }, { weight: 95, reps: 8, date: daysAgo(358) }, { weight: 95, reps: 6, date: daysAgo(358) },
    { weight: 95, reps: 10, date: daysAgo(351) }, { weight: 95, reps: 8, date: daysAgo(351) },
    { weight: 105, reps: 6, date: daysAgo(344) }, { weight: 95, reps: 10, date: daysAgo(344) },
    { weight: 105, reps: 7, date: daysAgo(337) }, { weight: 105, reps: 6, date: daysAgo(337) },
    { weight: 105, reps: 8, date: daysAgo(330) }, { weight: 105, reps: 8, date: daysAgo(330) }, { weight: 95, reps: 12, date: daysAgo(330) },
    // Starting to push — novice gains
    { weight: 115, reps: 5, date: daysAgo(319) }, { weight: 105, reps: 8, date: daysAgo(319) }, { weight: 105, reps: 7, date: daysAgo(319) },
    { weight: 115, reps: 6, date: daysAgo(312) }, { weight: 115, reps: 5, date: daysAgo(312) },
    { weight: 115, reps: 5, date: daysAgo(305) }, { weight: 115, reps: 4, date: daysAgo(305) }, // bad day
    { weight: 115, reps: 7, date: daysAgo(298) }, { weight: 115, reps: 6, date: daysAgo(298) }, { weight: 105, reps: 10, date: daysAgo(298) },
    { weight: 125, reps: 4, date: daysAgo(291) }, { weight: 115, reps: 8, date: daysAgo(291) },
    { weight: 125, reps: 5, date: daysAgo(284) }, { weight: 125, reps: 5, date: daysAgo(284) }, { weight: 115, reps: 8, date: daysAgo(284) },
    // Deload week
    { weight: 95, reps: 10, date: daysAgo(277) }, { weight: 95, reps: 10, date: daysAgo(277) },
    // Building back up
    { weight: 125, reps: 6, date: daysAgo(270) }, { weight: 125, reps: 6, date: daysAgo(270) }, { weight: 115, reps: 10, date: daysAgo(270) },
    { weight: 135, reps: 3, date: daysAgo(263) }, { weight: 125, reps: 8, date: daysAgo(263) },
    { weight: 135, reps: 4, date: daysAgo(256) }, { weight: 135, reps: 4, date: daysAgo(256) }, { weight: 125, reps: 8, date: daysAgo(256) },
    { weight: 135, reps: 5, date: daysAgo(249) }, { weight: 135, reps: 5, date: daysAgo(249) },
    { weight: 135, reps: 5, date: daysAgo(242) }, { weight: 135, reps: 4, date: daysAgo(242) }, { weight: 125, reps: 10, date: daysAgo(242) },
    // Vacation gap — no training for ~2 weeks
    // Back from vacation, lost some strength
    { weight: 125, reps: 6, date: daysAgo(222) }, { weight: 125, reps: 5, date: daysAgo(222) },
    { weight: 135, reps: 4, date: daysAgo(215) }, { weight: 125, reps: 8, date: daysAgo(215) },
    { weight: 135, reps: 5, date: daysAgo(208) }, { weight: 135, reps: 5, date: daysAgo(208) }, { weight: 125, reps: 8, date: daysAgo(208) },
    // Plateau at 135 — stuck for weeks
    { weight: 135, reps: 6, date: daysAgo(201) }, { weight: 135, reps: 5, date: daysAgo(201) },
    { weight: 145, reps: 3, date: daysAgo(194) }, { weight: 135, reps: 6, date: daysAgo(194) },
    { weight: 145, reps: 3, date: daysAgo(187) }, { weight: 135, reps: 7, date: daysAgo(187) },
    { weight: 135, reps: 8, date: daysAgo(180) }, { weight: 135, reps: 6, date: daysAgo(180) },
    { weight: 145, reps: 4, date: daysAgo(173) }, { weight: 145, reps: 3, date: daysAgo(173) },
    // Breakthrough
    { weight: 145, reps: 5, date: daysAgo(166) }, { weight: 145, reps: 5, date: daysAgo(166) }, { weight: 135, reps: 8, date: daysAgo(166) },
    { weight: 155, reps: 3, date: daysAgo(159) }, { weight: 145, reps: 6, date: daysAgo(159) },
    { weight: 145, reps: 6, date: daysAgo(152) }, { weight: 145, reps: 6, date: daysAgo(152) },
    { weight: 155, reps: 4, date: daysAgo(145) }, { weight: 145, reps: 8, date: daysAgo(145) },
    // Deload
    { weight: 115, reps: 10, date: daysAgo(138) }, { weight: 115, reps: 10, date: daysAgo(138) },
    // Peak phase
    { weight: 155, reps: 5, date: daysAgo(131) }, { weight: 155, reps: 4, date: daysAgo(131) }, { weight: 145, reps: 8, date: daysAgo(131) },
    { weight: 155, reps: 5, date: daysAgo(124) }, { weight: 155, reps: 5, date: daysAgo(124) },
    { weight: 165, reps: 3, date: daysAgo(117) }, { weight: 155, reps: 6, date: daysAgo(117) },
    { weight: 165, reps: 4, date: daysAgo(110) }, { weight: 155, reps: 7, date: daysAgo(110) }, { weight: 145, reps: 10, date: daysAgo(110) },
    // Missed a week (sick)
    { weight: 155, reps: 5, date: daysAgo(96) }, { weight: 155, reps: 4, date: daysAgo(96) },
    { weight: 165, reps: 4, date: daysAgo(89) }, { weight: 165, reps: 3, date: daysAgo(89) }, { weight: 155, reps: 6, date: daysAgo(89) },
    { weight: 165, reps: 5, date: daysAgo(82) }, { weight: 155, reps: 8, date: daysAgo(82) },
    { weight: 175, reps: 3, date: daysAgo(75) }, { weight: 165, reps: 5, date: daysAgo(75) },
    { weight: 165, reps: 5, date: daysAgo(68) }, { weight: 165, reps: 5, date: daysAgo(68) }, { weight: 155, reps: 8, date: daysAgo(68) },
    { weight: 175, reps: 3, date: daysAgo(61) }, { weight: 175, reps: 2, date: daysAgo(61) }, // grinder
    { weight: 165, reps: 6, date: daysAgo(54) }, { weight: 165, reps: 6, date: daysAgo(54) },
    { weight: 175, reps: 4, date: daysAgo(47) }, { weight: 165, reps: 7, date: daysAgo(47) },
    // Recent — hitting new PRs
    { weight: 185, reps: 2, date: daysAgo(40) }, { weight: 175, reps: 5, date: daysAgo(40) }, { weight: 155, reps: 10, date: daysAgo(40) },
    { weight: 175, reps: 5, date: daysAgo(33) }, { weight: 175, reps: 4, date: daysAgo(33) },
    { weight: 185, reps: 3, date: daysAgo(26) }, { weight: 175, reps: 5, date: daysAgo(26) }, { weight: 165, reps: 8, date: daysAgo(26) },
    { weight: 175, reps: 6, date: daysAgo(19) }, { weight: 175, reps: 5, date: daysAgo(19) },
    { weight: 185, reps: 3, date: daysAgo(12) }, { weight: 185, reps: 3, date: daysAgo(12) }, { weight: 165, reps: 8, date: daysAgo(12) },
    { weight: 195, reps: 2, date: daysAgo(5) }, { weight: 185, reps: 4, date: daysAgo(5) }, { weight: 175, reps: 6, date: daysAgo(5) },
  ]},
  // Squat — ~365 days, trains 2x/week, some sessions with 3-4 sets
  { exercise: 'Squat', sets: [
    { weight: 115, reps: 8, date: daysAgo(356) }, { weight: 115, reps: 8, date: daysAgo(356) },
    { weight: 135, reps: 5, date: daysAgo(349) }, { weight: 115, reps: 10, date: daysAgo(349) },
    { weight: 135, reps: 6, date: daysAgo(340) }, { weight: 135, reps: 5, date: daysAgo(340) },
    { weight: 135, reps: 8, date: daysAgo(333) }, { weight: 135, reps: 7, date: daysAgo(333) }, { weight: 115, reps: 12, date: daysAgo(333) },
    { weight: 155, reps: 5, date: daysAgo(326) }, { weight: 145, reps: 6, date: daysAgo(326) },
    { weight: 155, reps: 5, date: daysAgo(319) }, { weight: 155, reps: 4, date: daysAgo(319) },
    { weight: 155, reps: 6, date: daysAgo(312) }, { weight: 155, reps: 6, date: daysAgo(312) }, { weight: 135, reps: 10, date: daysAgo(312) },
    { weight: 165, reps: 4, date: daysAgo(298) }, { weight: 155, reps: 6, date: daysAgo(298) },
    { weight: 165, reps: 5, date: daysAgo(291) }, { weight: 165, reps: 4, date: daysAgo(291) },
    // Deload
    { weight: 135, reps: 8, date: daysAgo(284) },
    { weight: 175, reps: 4, date: daysAgo(270) }, { weight: 165, reps: 6, date: daysAgo(270) },
    { weight: 175, reps: 5, date: daysAgo(263) }, { weight: 175, reps: 4, date: daysAgo(263) }, { weight: 155, reps: 8, date: daysAgo(263) },
    { weight: 185, reps: 3, date: daysAgo(249) }, { weight: 175, reps: 5, date: daysAgo(249) },
    { weight: 185, reps: 4, date: daysAgo(242) }, { weight: 175, reps: 6, date: daysAgo(242) },
    // Plateau
    { weight: 185, reps: 4, date: daysAgo(228) }, { weight: 185, reps: 3, date: daysAgo(228) },
    { weight: 185, reps: 4, date: daysAgo(221) }, { weight: 185, reps: 4, date: daysAgo(221) },
    { weight: 195, reps: 2, date: daysAgo(214) }, { weight: 185, reps: 5, date: daysAgo(214) },
    { weight: 185, reps: 5, date: daysAgo(207) }, { weight: 185, reps: 5, date: daysAgo(207) }, { weight: 165, reps: 10, date: daysAgo(207) },
    { weight: 195, reps: 3, date: daysAgo(193) }, { weight: 185, reps: 6, date: daysAgo(193) },
    { weight: 195, reps: 4, date: daysAgo(186) }, { weight: 195, reps: 3, date: daysAgo(186) },
    { weight: 205, reps: 3, date: daysAgo(172) }, { weight: 195, reps: 5, date: daysAgo(172) }, { weight: 185, reps: 6, date: daysAgo(172) },
    { weight: 195, reps: 5, date: daysAgo(165) }, { weight: 195, reps: 5, date: daysAgo(165) },
    // Deload
    { weight: 155, reps: 8, date: daysAgo(158) },
    { weight: 205, reps: 4, date: daysAgo(145) }, { weight: 195, reps: 6, date: daysAgo(145) },
    { weight: 205, reps: 4, date: daysAgo(138) }, { weight: 205, reps: 3, date: daysAgo(138) }, { weight: 185, reps: 8, date: daysAgo(138) },
    { weight: 215, reps: 3, date: daysAgo(124) }, { weight: 205, reps: 5, date: daysAgo(124) },
    { weight: 205, reps: 5, date: daysAgo(117) }, { weight: 205, reps: 5, date: daysAgo(117) },
    { weight: 215, reps: 3, date: daysAgo(103) }, { weight: 215, reps: 2, date: daysAgo(103) }, { weight: 195, reps: 6, date: daysAgo(103) },
    { weight: 215, reps: 4, date: daysAgo(96) }, { weight: 205, reps: 6, date: daysAgo(96) },
    { weight: 225, reps: 2, date: daysAgo(82) }, { weight: 215, reps: 4, date: daysAgo(82) },
    { weight: 215, reps: 5, date: daysAgo(75) }, { weight: 215, reps: 4, date: daysAgo(75) }, { weight: 195, reps: 8, date: daysAgo(75) },
    { weight: 225, reps: 3, date: daysAgo(61) }, { weight: 215, reps: 5, date: daysAgo(61) },
    { weight: 225, reps: 3, date: daysAgo(54) }, { weight: 225, reps: 3, date: daysAgo(54) }, { weight: 205, reps: 7, date: daysAgo(54) },
    { weight: 235, reps: 2, date: daysAgo(40) }, { weight: 225, reps: 4, date: daysAgo(40) },
    { weight: 225, reps: 5, date: daysAgo(33) }, { weight: 225, reps: 4, date: daysAgo(33) }, { weight: 205, reps: 8, date: daysAgo(33) },
    { weight: 245, reps: 2, date: daysAgo(19) }, { weight: 235, reps: 3, date: daysAgo(19) },
    { weight: 235, reps: 4, date: daysAgo(12) }, { weight: 225, reps: 5, date: daysAgo(12) }, { weight: 205, reps: 8, date: daysAgo(12) },
    { weight: 245, reps: 3, date: daysAgo(5) }, { weight: 235, reps: 4, date: daysAgo(5) },
  ]},
  // Deadlift — trains 1x/week, heavy singles and doubles mixed with volume
  { exercise: 'Deadlift', sets: [
    { weight: 155, reps: 5, date: daysAgo(352) }, { weight: 155, reps: 5, date: daysAgo(352) },
    { weight: 185, reps: 3, date: daysAgo(338) }, { weight: 165, reps: 6, date: daysAgo(338) },
    { weight: 185, reps: 4, date: daysAgo(324) }, { weight: 185, reps: 3, date: daysAgo(324) },
    { weight: 205, reps: 2, date: daysAgo(310) }, { weight: 185, reps: 5, date: daysAgo(310) },
    { weight: 205, reps: 3, date: daysAgo(296) }, { weight: 205, reps: 3, date: daysAgo(296) }, { weight: 185, reps: 6, date: daysAgo(296) },
    { weight: 215, reps: 2, date: daysAgo(282) }, { weight: 205, reps: 4, date: daysAgo(282) },
    { weight: 225, reps: 1, date: daysAgo(268) }, { weight: 205, reps: 5, date: daysAgo(268) }, // first 225
    { weight: 225, reps: 2, date: daysAgo(254) }, { weight: 215, reps: 4, date: daysAgo(254) },
    { weight: 225, reps: 3, date: daysAgo(240) }, { weight: 225, reps: 2, date: daysAgo(240) },
    // Tweak — took 2 weeks easy
    { weight: 185, reps: 5, date: daysAgo(219) }, { weight: 185, reps: 5, date: daysAgo(219) },
    { weight: 225, reps: 2, date: daysAgo(205) }, { weight: 205, reps: 5, date: daysAgo(205) },
    { weight: 235, reps: 2, date: daysAgo(191) }, { weight: 225, reps: 3, date: daysAgo(191) },
    { weight: 245, reps: 1, date: daysAgo(177) }, { weight: 225, reps: 4, date: daysAgo(177) }, { weight: 205, reps: 6, date: daysAgo(177) },
    { weight: 245, reps: 2, date: daysAgo(163) }, { weight: 235, reps: 3, date: daysAgo(163) },
    { weight: 255, reps: 1, date: daysAgo(149) }, { weight: 245, reps: 2, date: daysAgo(149) },
    { weight: 245, reps: 3, date: daysAgo(135) }, { weight: 235, reps: 4, date: daysAgo(135) }, { weight: 215, reps: 6, date: daysAgo(135) },
    { weight: 255, reps: 2, date: daysAgo(121) }, { weight: 245, reps: 3, date: daysAgo(121) },
    { weight: 265, reps: 1, date: daysAgo(107) }, { weight: 255, reps: 2, date: daysAgo(107) },
    { weight: 255, reps: 3, date: daysAgo(93) }, { weight: 245, reps: 4, date: daysAgo(93) }, { weight: 225, reps: 6, date: daysAgo(93) },
    { weight: 275, reps: 1, date: daysAgo(79) }, { weight: 265, reps: 2, date: daysAgo(79) },
    { weight: 275, reps: 2, date: daysAgo(65) }, { weight: 255, reps: 4, date: daysAgo(65) },
    { weight: 285, reps: 1, date: daysAgo(51) }, { weight: 275, reps: 2, date: daysAgo(51) }, { weight: 245, reps: 5, date: daysAgo(51) },
    { weight: 275, reps: 3, date: daysAgo(37) }, { weight: 265, reps: 3, date: daysAgo(37) },
    { weight: 295, reps: 1, date: daysAgo(23) }, { weight: 275, reps: 3, date: daysAgo(23) }, { weight: 255, reps: 5, date: daysAgo(23) },
    { weight: 285, reps: 2, date: daysAgo(9) }, { weight: 275, reps: 3, date: daysAgo(9) },
    { weight: 305, reps: 1, date: daysAgo(2) }, { weight: 285, reps: 2, date: daysAgo(2) },
  ]},
  // Overhead Press — slowest progression, most frustrating plateau
  { exercise: 'Overhead Press', sets: [
    { weight: 45, reps: 10, date: daysAgo(345) }, { weight: 45, reps: 10, date: daysAgo(345) },
    { weight: 55, reps: 8, date: daysAgo(331) }, { weight: 55, reps: 7, date: daysAgo(331) },
    { weight: 55, reps: 8, date: daysAgo(317) }, { weight: 55, reps: 8, date: daysAgo(317) }, { weight: 45, reps: 12, date: daysAgo(317) },
    { weight: 65, reps: 5, date: daysAgo(303) }, { weight: 55, reps: 10, date: daysAgo(303) },
    { weight: 65, reps: 6, date: daysAgo(289) }, { weight: 65, reps: 5, date: daysAgo(289) },
    { weight: 65, reps: 6, date: daysAgo(275) }, { weight: 65, reps: 6, date: daysAgo(275) }, { weight: 55, reps: 10, date: daysAgo(275) },
    { weight: 75, reps: 3, date: daysAgo(261) }, { weight: 65, reps: 8, date: daysAgo(261) },
    { weight: 75, reps: 4, date: daysAgo(247) }, { weight: 65, reps: 8, date: daysAgo(247) },
    // Stuck at 75 for months
    { weight: 75, reps: 4, date: daysAgo(233) }, { weight: 75, reps: 3, date: daysAgo(233) },
    { weight: 75, reps: 5, date: daysAgo(219) }, { weight: 75, reps: 4, date: daysAgo(219) },
    { weight: 75, reps: 5, date: daysAgo(205) }, { weight: 75, reps: 5, date: daysAgo(205) }, { weight: 65, reps: 8, date: daysAgo(205) },
    { weight: 80, reps: 3, date: daysAgo(191) }, { weight: 75, reps: 6, date: daysAgo(191) },
    { weight: 75, reps: 6, date: daysAgo(177) }, { weight: 75, reps: 5, date: daysAgo(177) },
    { weight: 80, reps: 4, date: daysAgo(163) }, { weight: 75, reps: 6, date: daysAgo(163) },
    { weight: 85, reps: 3, date: daysAgo(149) }, { weight: 80, reps: 5, date: daysAgo(149) }, { weight: 65, reps: 10, date: daysAgo(149) },
    { weight: 85, reps: 4, date: daysAgo(135) }, { weight: 85, reps: 3, date: daysAgo(135) },
    { weight: 85, reps: 5, date: daysAgo(121) }, { weight: 85, reps: 4, date: daysAgo(121) },
    { weight: 90, reps: 3, date: daysAgo(107) }, { weight: 85, reps: 5, date: daysAgo(107) },
    { weight: 85, reps: 6, date: daysAgo(93) }, { weight: 85, reps: 5, date: daysAgo(93) }, { weight: 75, reps: 8, date: daysAgo(93) },
    { weight: 95, reps: 3, date: daysAgo(79) }, { weight: 85, reps: 6, date: daysAgo(79) },
    { weight: 95, reps: 3, date: daysAgo(65) }, { weight: 95, reps: 2, date: daysAgo(65) },
    { weight: 95, reps: 4, date: daysAgo(51) }, { weight: 85, reps: 7, date: daysAgo(51) }, { weight: 75, reps: 10, date: daysAgo(51) },
    { weight: 100, reps: 2, date: daysAgo(37) }, { weight: 95, reps: 4, date: daysAgo(37) },
    { weight: 95, reps: 5, date: daysAgo(23) }, { weight: 95, reps: 5, date: daysAgo(23) }, { weight: 85, reps: 8, date: daysAgo(23) },
    { weight: 105, reps: 2, date: daysAgo(9) }, { weight: 95, reps: 5, date: daysAgo(9) },
    { weight: 100, reps: 4, date: daysAgo(2) }, { weight: 95, reps: 6, date: daysAgo(2) },
  ]},
  // Barbell Row — inconsistent frequency, sometimes 2x/week, sometimes skipped
  { exercise: 'Barbell Row', sets: [
    { weight: 75, reps: 8, date: daysAgo(342) }, { weight: 75, reps: 8, date: daysAgo(342) },
    { weight: 85, reps: 6, date: daysAgo(328) }, { weight: 75, reps: 10, date: daysAgo(328) },
    { weight: 95, reps: 5, date: daysAgo(314) }, { weight: 85, reps: 8, date: daysAgo(314) },
    { weight: 95, reps: 6, date: daysAgo(300) }, { weight: 95, reps: 5, date: daysAgo(300) }, { weight: 85, reps: 8, date: daysAgo(300) },
    { weight: 95, reps: 8, date: daysAgo(279) }, { weight: 95, reps: 7, date: daysAgo(279) },
    { weight: 105, reps: 5, date: daysAgo(265) }, { weight: 95, reps: 8, date: daysAgo(265) },
    { weight: 105, reps: 6, date: daysAgo(251) }, { weight: 105, reps: 5, date: daysAgo(251) },
    { weight: 115, reps: 4, date: daysAgo(237) }, { weight: 105, reps: 7, date: daysAgo(237) }, { weight: 95, reps: 10, date: daysAgo(237) },
    // Skipped a few weeks
    { weight: 105, reps: 6, date: daysAgo(209) }, { weight: 105, reps: 6, date: daysAgo(209) },
    { weight: 115, reps: 5, date: daysAgo(195) }, { weight: 115, reps: 4, date: daysAgo(195) },
    { weight: 115, reps: 5, date: daysAgo(181) }, { weight: 115, reps: 5, date: daysAgo(181) }, { weight: 105, reps: 8, date: daysAgo(181) },
    { weight: 125, reps: 4, date: daysAgo(167) }, { weight: 115, reps: 6, date: daysAgo(167) },
    { weight: 125, reps: 5, date: daysAgo(146) }, { weight: 125, reps: 4, date: daysAgo(146) },
    { weight: 125, reps: 5, date: daysAgo(132) }, { weight: 125, reps: 5, date: daysAgo(132) }, { weight: 115, reps: 8, date: daysAgo(132) },
    { weight: 135, reps: 4, date: daysAgo(118) }, { weight: 125, reps: 6, date: daysAgo(118) },
    { weight: 135, reps: 4, date: daysAgo(104) }, { weight: 135, reps: 3, date: daysAgo(104) },
    { weight: 135, reps: 5, date: daysAgo(83) }, { weight: 125, reps: 8, date: daysAgo(83) }, { weight: 115, reps: 10, date: daysAgo(83) },
    { weight: 145, reps: 3, date: daysAgo(69) }, { weight: 135, reps: 5, date: daysAgo(69) },
    { weight: 145, reps: 4, date: daysAgo(48) }, { weight: 135, reps: 6, date: daysAgo(48) },
    { weight: 145, reps: 5, date: daysAgo(34) }, { weight: 145, reps: 4, date: daysAgo(34) }, { weight: 135, reps: 8, date: daysAgo(34) },
    { weight: 155, reps: 3, date: daysAgo(20) }, { weight: 145, reps: 5, date: daysAgo(20) },
    { weight: 155, reps: 4, date: daysAgo(6) }, { weight: 145, reps: 6, date: daysAgo(6) }, { weight: 135, reps: 8, date: daysAgo(6) },
  ]},
]

const SAMPLE_WEIGHTS = [
  // ~365 days. Irregular frequency — sometimes daily, sometimes skips days.
  // Bulk: 168 → 191 with water weight spikes, holiday bloat, missed weigh-ins
  // Cut: 188 → 172 with stalls, refeed bumps, and inconsistent drops
  { weight: 168.0, date: daysAgo(362) },
  { weight: 169.5, date: daysAgo(358) }, // water weight from creatine start
  { weight: 168.5, date: daysAgo(355) },
  { weight: 169.0, date: daysAgo(349) },
  { weight: 170.0, date: daysAgo(344) },
  { weight: 169.5, date: daysAgo(340) },
  { weight: 170.5, date: daysAgo(333) },
  { weight: 171.5, date: daysAgo(328) },
  { weight: 170.5, date: daysAgo(323) }, // dropped after stomach bug
  { weight: 171.0, date: daysAgo(318) },
  { weight: 172.5, date: daysAgo(312) },
  { weight: 173.0, date: daysAgo(305) },
  { weight: 172.5, date: daysAgo(300) },
  { weight: 174.0, date: daysAgo(294) },
  { weight: 175.0, date: daysAgo(287) },
  { weight: 174.5, date: daysAgo(282) },
  { weight: 175.5, date: daysAgo(275) },
  { weight: 176.0, date: daysAgo(270) },
  { weight: 177.5, date: daysAgo(263) }, // post-holiday bloat
  { weight: 176.0, date: daysAgo(260) }, // settled back down
  { weight: 176.5, date: daysAgo(254) },
  { weight: 177.0, date: daysAgo(248) },
  { weight: 178.0, date: daysAgo(241) },
  { weight: 178.5, date: daysAgo(235) },
  { weight: 179.0, date: daysAgo(228) },
  { weight: 179.5, date: daysAgo(222) },
  { weight: 180.5, date: daysAgo(215) },
  { weight: 180.0, date: daysAgo(210) },
  { weight: 181.0, date: daysAgo(203) },
  { weight: 182.0, date: daysAgo(196) },
  { weight: 181.5, date: daysAgo(191) },
  { weight: 183.0, date: daysAgo(184) },
  { weight: 184.0, date: daysAgo(177) },
  { weight: 184.5, date: daysAgo(170) },
  { weight: 185.5, date: daysAgo(163) },
  { weight: 185.0, date: daysAgo(158) },
  { weight: 186.5, date: daysAgo(151) },
  { weight: 187.0, date: daysAgo(145) },
  { weight: 188.0, date: daysAgo(138) },
  { weight: 189.5, date: daysAgo(131) }, // all-time high territory
  { weight: 191.0, date: daysAgo(126) }, // post-birthday weekend
  { weight: 189.0, date: daysAgo(123) },
  { weight: 188.0, date: daysAgo(120) }, // decided to start cutting
  // Cut phase — messier, with stalls and refeed days
  { weight: 188.5, date: daysAgo(117) }, // water weight up first week
  { weight: 187.0, date: daysAgo(113) },
  { weight: 186.5, date: daysAgo(110) },
  { weight: 187.5, date: daysAgo(107) }, // refeed day spike
  { weight: 186.0, date: daysAgo(103) },
  { weight: 185.0, date: daysAgo(99) },
  { weight: 185.5, date: daysAgo(96) },
  { weight: 184.5, date: daysAgo(92) },
  { weight: 184.0, date: daysAgo(88) },
  { weight: 184.5, date: daysAgo(85) },
  { weight: 183.5, date: daysAgo(81) },
  { weight: 183.0, date: daysAgo(77) },
  { weight: 184.0, date: daysAgo(74) }, // weekend sodium
  { weight: 182.5, date: daysAgo(70) },
  { weight: 182.0, date: daysAgo(66) },
  // Stall — same weight for 2 weeks
  { weight: 182.0, date: daysAgo(62) },
  { weight: 182.5, date: daysAgo(59) },
  { weight: 182.0, date: daysAgo(55) },
  { weight: 181.5, date: daysAgo(52) },
  // Whoosh effect — sudden drop
  { weight: 180.0, date: daysAgo(48) },
  { weight: 179.5, date: daysAgo(45) },
  { weight: 180.0, date: daysAgo(41) },
  { weight: 179.0, date: daysAgo(38) },
  { weight: 178.0, date: daysAgo(34) },
  { weight: 178.5, date: daysAgo(31) }, // missed a few days
  { weight: 177.0, date: daysAgo(27) },
  { weight: 176.5, date: daysAgo(24) },
  { weight: 177.0, date: daysAgo(21) },
  { weight: 176.0, date: daysAgo(17) },
  { weight: 175.0, date: daysAgo(14) },
  { weight: 175.5, date: daysAgo(11) },
  { weight: 174.0, date: daysAgo(8) },
  { weight: 174.5, date: daysAgo(6) },
  { weight: 173.0, date: daysAgo(3) },
  { weight: 172.5, date: daysAgo(1) },
]

function finish(sampleData: boolean) {
  localStorage.setItem('onboarding-complete', 'true')
  if (sampleData) {
    localStorage.setItem('sample-data', 'true')
  }
  emit('complete')
}

function goToStarter(sampleData: boolean) {
  pendingSampleData = sampleData
  step.value = 'explainer'
}

const { currentTheme } = useTheme()

function confirmStarter() {
  if (selectedStarter.value) {
    progressionStore.setStarterTheme(selectedStarter.value)
    currentTheme.value = selectedStarter.value
  }
  finish(pendingSampleData)
}

function skipStarter() {
  finish(pendingSampleData)
}

function chooseEmpty() {
  goToStarter(false)
}

function chooseStarter() {
  for (const ex of STARTER_EXERCISES) {
    workoutStore.addExercise(ex.name, ex.tags)
  }
  goToStarter(false)
}

const noSync = { sync: false }

function chooseExplore() {
  // Add exercises with sample sets — skip Supabase sync for sample data (MAS-197)
  for (const group of SAMPLE_SETS) {
    const starter = STARTER_EXERCISES.find(e => e.name === group.exercise)
    const id = workoutStore.addExercise(group.exercise, starter?.tags || [], noSync)
    if (!id) continue
    for (const set of group.sets) {
      workoutStore.logSet(id, set.weight, set.reps, set.date, noSync)
    }
  }
  // Add remaining starter exercises without sets
  for (const ex of STARTER_EXERCISES) {
    if (!SAMPLE_SETS.find(g => g.exercise === ex.name)) {
      workoutStore.addExercise(ex.name, ex.tags, noSync)
    }
  }
  // Add sample bodyweight entries
  for (const entry of SAMPLE_WEIGHTS) {
    bwStore.addEntry(entry.weight, entry.date, noSync)
  }
  goToStarter(true)
}
</script>

<style scoped>
.obScreen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80svh;
  padding: 24px;
}

.obCard {
  width: 100%;
  max-width: 380px;
  text-align: center;
}

.obLogo {
  font-size: 48px;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -1.5px;
  margin-bottom: 8px;
}

.obTagline {
  font-size: var(--font-callout);
  color: var(--text-secondary);
  margin-bottom: 32px;
  line-height: 1.5;
}

.obOptions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.obOption {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 16px;
  min-height: 44px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.obOption:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.obOption:active {
  opacity: 0.85;
}

.obOptionIcon {
  font-size: 28px;
  flex-shrink: 0;
}

.obOptionText {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.obOptionText strong {
  font-size: var(--font-callout);
  font-weight: 600;
  color: var(--text-primary);
}

.obOptionText span {
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  line-height: 1.3;
}

/* ─── Progression explainer ──────────────────────────────────────── */

.obExplainer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 32px;
  text-align: left;
}

.obExplainerRow {
  font-size: var(--font-callout);
  color: var(--text-secondary);
  padding-left: 8px;
  border-left: 3px solid var(--accent);
}

/* ─── Starter theme picker ───────────────────────────────────────── */

.obStarterGrid {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-bottom: 32px;
}

.obStarterCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
}

.obStarterDot {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 3px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-accent);
  transition: border-color 0.2s, transform 0.2s;
}

.obStarterCard.selected .obStarterDot {
  border-color: var(--accent);
  transform: scale(1.1);
}

.obStarterLabel {
  font-size: var(--font-callout);
  font-weight: 600;
  color: var(--text-secondary);
  transition: color 0.15s;
}

.obStarterCard.selected .obStarterLabel {
  color: var(--text-primary);
}

.obStarterWarning {
  font-size: var(--font-caption2);
  color: var(--text-tertiary);
  text-align: center;
  margin-bottom: 16px;
  line-height: 1.4;
}

.obStarterConfirm {
  width: 100%;
  padding: 16px;
  min-height: 44px;
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: 12px;
  font-size: var(--font-callout);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.15s;
  margin-bottom: 12px;
}

.obStarterConfirm:disabled {
  opacity: 0.4;
  cursor: default;
}

.obStarterSkip {
  width: 100%;
  padding: 12px;
  min-height: 44px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: var(--font-footnote);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}
</style>
