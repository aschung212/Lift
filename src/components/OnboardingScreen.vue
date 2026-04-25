<template>
  <div class="obScreen">
    <div class="obCard">
      <!-- Step 1: Setup path -->
      <template v-if="step === 'setup'">
        <div class="obHero">
          <div class="obLogo">Lift</div>
          <p class="obSubtitle">Strength tracking, quietly.</p>
        </div>
        <p class="obTagline">How would you like to get started?</p>

        <div class="obOptions">
          <button
            class="obOption obOptionFeatured"
            @click="chooseStarter"
            aria-label="Popular Exercises — Pre-load 6 common lifts with tags, start logging in seconds"
          >
            <span class="obOptionIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                <rect x="2" y="10" width="4" height="4" rx="1"/>
                <rect x="18" y="10" width="4" height="4" rx="1"/>
                <rect x="5" y="8" width="3" height="8" rx="1"/>
                <rect x="16" y="8" width="3" height="8" rx="1"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </span>
            <span class="obOptionText">
              <strong>Popular exercises</strong>
              <span>Pre-load 6 common lifts with tags — start logging in seconds.</span>
            </span>
          </button>

          <button
            class="obOption"
            @click="chooseEmpty"
            aria-label="Start Empty — Add your own exercises from scratch"
          >
            <span class="obOptionIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </span>
            <span class="obOptionText">
              <strong>Start empty</strong>
              <span>Add your own exercises from scratch.</span>
            </span>
          </button>

          <button
            class="obOption"
            @click="chooseExplore"
            aria-label="Explore First — See the app with sample data, clear it when you're ready"
          >
            <span class="obOptionIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </span>
            <span class="obOptionText">
              <strong>Explore first</strong>
              <span>See the app with sample data — clear it when you're ready.</span>
            </span>
          </button>
        </div>
      </template>

      <!-- Steps 2-4: Progression explainer + starter pick + weekly goal -->
      <template v-else>
        <div class="obLogo">Lift</div>
        <StarterPickerFlow
          @confirm="handleStarterConfirm"
          @skip="handleStarterSkip"
          @preview="handleStarterPreview"
          @revert-preview="handleStarterRevertPreview"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useWorkoutStore, type ExerciseInputMode } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { useProgressionStore } from '../stores/progression'
import { useTheme, type ThemeId } from '../composables/useTheme'
import { useAnalytics } from '../composables/useAnalytics'
import StarterPickerFlow from './StarterPickerFlow.vue'

const emit = defineEmits<{ complete: []; started: [] }>()
const workoutStore = useWorkoutStore()
const bwStore = useBodyweightStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()

const step = ref<'setup' | 'starter-flow'>('setup')
let pendingSampleData = false

const STARTER_EXERCISES: { name: string; tags: string[]; inputMode?: ExerciseInputMode }[] = [
  { name: 'Bench Press', tags: ['Push', 'Chest'], inputMode: 'plates' },
  { name: 'Squat', tags: ['Legs'], inputMode: 'plates' },
  { name: 'Deadlift', tags: ['Pull', 'Legs'], inputMode: 'plates' },
  { name: 'Overhead Press', tags: ['Push', 'Shoulders'], inputMode: 'plates' },
  { name: 'Barbell Row', tags: ['Pull', 'Back'], inputMode: 'plates' },
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
  step.value = 'starter-flow'
}

const { currentTheme, previewTheme, revertPreview } = useTheme()

function handleStarterPreview(themeId: ThemeId) {
  previewTheme(themeId)
}

function handleStarterRevertPreview() {
  revertPreview()
}

function handleStarterConfirm(themeId: ThemeId, weeklyGoal: number) {
  revertPreview()
  progressionStore.setStarterTheme(themeId, weeklyGoal)
  currentTheme.value = themeId
  finish(pendingSampleData)
}

function handleStarterSkip() {
  revertPreview()
  finish(pendingSampleData)
}

function chooseEmpty() {
  logEvent('onboarding_choice', { choice: 'empty' })
  emit('started')
  goToStarter(false)
}

function chooseStarter() {
  logEvent('onboarding_choice', { choice: 'starter' })
  emit('started')
  for (const ex of STARTER_EXERCISES) {
    workoutStore.addExercise(ex.name, ex.tags, ex.inputMode ? { inputMode: ex.inputMode } : undefined)
  }
  goToStarter(false)
}

const noSync = { sync: false }

function chooseExplore() {
  logEvent('onboarding_choice', { choice: 'explore' })
  emit('started')
  // Add exercises with sample sets — skip Supabase sync for sample data (MAS-197)
  for (const group of SAMPLE_SETS) {
    const starter = STARTER_EXERCISES.find(e => e.name === group.exercise)
    const opts = starter?.inputMode ? { sync: false, inputMode: starter.inputMode } as const : noSync
    const id = workoutStore.addExercise(group.exercise, starter?.tags || [], opts)
    if (!id) continue
    for (const set of group.sets) {
      workoutStore.logSet(id, set.weight, set.reps, set.date, noSync)
    }
  }
  // Add remaining starter exercises without sets
  for (const ex of STARTER_EXERCISES) {
    if (!SAMPLE_SETS.find(g => g.exercise === ex.name)) {
      const opts = ex.inputMode ? { sync: false, inputMode: ex.inputMode } as const : noSync
      workoutStore.addExercise(ex.name, ex.tags, opts)
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
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
  background:
    radial-gradient(ellipse 70% 55% at 15% 10%, var(--accent-subtle, rgba(212,175,55,0.08)) 0%, transparent 65%),
    radial-gradient(ellipse 55% 45% at 85% 80%, var(--accent-subtle, rgba(212,175,55,0.06)) 0%, transparent 65%);
}

.obCard {
  width: 100%;
  max-width: 360px;
  text-align: center;
}

.obHero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
}

.obLogo {
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 72px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.035em;
  color: var(--accent);
}

.obSubtitle {
  font-size: var(--font-callout, 14px);
  font-weight: 500;
  color: var(--text-secondary);
  line-height: 1.4;
  margin: 0;
}

.obTagline {
  font-size: var(--font-callout, 14px);
  color: var(--text-muted);
  margin-bottom: 16px;
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
  gap: 16px;
  width: 100%;
  padding: 16px;
  min-height: 72px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--text-primary);
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}

.obOption:active {
  transform: scale(0.98);
  opacity: 0.85;
}

/* "Recommended" path — same card chrome with a gold glow + gold border. */
.obOptionFeatured {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 4px 24px var(--accent-subtle, rgba(212,175,55,0.18));
}

.obOptionFeatured .obOptionIcon {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  box-shadow: 0 2px 12px var(--accent-subtle, rgba(212,175,55,0.35));
}

.obOptionIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  color: var(--accent);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.obOptionText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.obOptionText strong {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}

.obOptionText span {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

</style>
