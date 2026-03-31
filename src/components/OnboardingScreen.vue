<template>
  <div class="obScreen">
    <div class="obCard">
      <div class="obLogo">Lift</div>
      <p class="obTagline">How would you like to get started?</p>

      <div class="obOptions">
        <button class="obOption" @click="chooseEmpty">
          <span class="obOptionIcon">🚀</span>
          <span class="obOptionText">
            <strong>Start Empty</strong>
            <span>Add your own exercises from scratch</span>
          </span>
        </button>

        <button class="obOption" @click="chooseStarter">
          <span class="obOptionIcon">💪</span>
          <span class="obOptionText">
            <strong>Popular Exercises</strong>
            <span>Pre-load 6 common lifts with tags</span>
          </span>
        </button>

        <button class="obOption" @click="chooseExplore">
          <span class="obOptionIcon">👀</span>
          <span class="obOptionText">
            <strong>Explore First</strong>
            <span>See the app with sample data, clear it when ready</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'

const emit = defineEmits<{ complete: [] }>()
const workoutStore = useWorkoutStore()
const bwStore = useBodyweightStore()

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
  // Bench Press — ~120 days, mix of working sets and PRs
  { exercise: 'Bench Press', sets: [
    { weight: 115, reps: 10, date: daysAgo(118) },
    { weight: 115, reps: 8, date: daysAgo(115) },
    { weight: 125, reps: 8, date: daysAgo(111) },
    { weight: 125, reps: 8, date: daysAgo(108) },
    { weight: 135, reps: 6, date: daysAgo(104) },
    { weight: 125, reps: 10, date: daysAgo(101) },
    { weight: 135, reps: 8, date: daysAgo(97) },
    { weight: 135, reps: 7, date: daysAgo(94) },
    { weight: 145, reps: 5, date: daysAgo(90) },
    { weight: 135, reps: 8, date: daysAgo(87) },
    { weight: 145, reps: 6, date: daysAgo(83) },
    { weight: 145, reps: 6, date: daysAgo(80) },
    { weight: 155, reps: 5, date: daysAgo(76) },
    { weight: 145, reps: 8, date: daysAgo(73) },
    { weight: 155, reps: 5, date: daysAgo(69) },
    { weight: 155, reps: 6, date: daysAgo(62) },
    { weight: 165, reps: 4, date: daysAgo(55) },
    { weight: 155, reps: 7, date: daysAgo(52) },
    { weight: 155, reps: 8, date: daysAgo(48) },
    { weight: 165, reps: 5, date: daysAgo(41) },
    { weight: 165, reps: 5, date: daysAgo(38) },
    { weight: 170, reps: 4, date: daysAgo(34) },
    { weight: 155, reps: 10, date: daysAgo(31) },
    { weight: 175, reps: 3, date: daysAgo(27) },
    { weight: 165, reps: 6, date: daysAgo(24) },
    { weight: 175, reps: 4, date: daysAgo(20) },
    { weight: 165, reps: 8, date: daysAgo(17) },
    { weight: 175, reps: 5, date: daysAgo(13) },
    { weight: 180, reps: 3, date: daysAgo(10) },
    { weight: 165, reps: 8, date: daysAgo(6) },
    { weight: 185, reps: 3, date: daysAgo(3) },
  ]},
  // Squat — ~120 days
  { exercise: 'Squat', sets: [
    { weight: 155, reps: 8, date: daysAgo(117) },
    { weight: 155, reps: 8, date: daysAgo(114) },
    { weight: 175, reps: 6, date: daysAgo(110) },
    { weight: 165, reps: 8, date: daysAgo(107) },
    { weight: 185, reps: 5, date: daysAgo(103) },
    { weight: 175, reps: 8, date: daysAgo(100) },
    { weight: 185, reps: 6, date: daysAgo(96) },
    { weight: 185, reps: 6, date: daysAgo(93) },
    { weight: 195, reps: 5, date: daysAgo(89) },
    { weight: 185, reps: 8, date: daysAgo(83) },
    { weight: 205, reps: 4, date: daysAgo(76) },
    { weight: 195, reps: 6, date: daysAgo(69) },
    { weight: 205, reps: 5, date: daysAgo(62) },
    { weight: 195, reps: 8, date: daysAgo(55) },
    { weight: 215, reps: 4, date: daysAgo(48) },
    { weight: 205, reps: 6, date: daysAgo(41) },
    { weight: 225, reps: 3, date: daysAgo(34) },
    { weight: 205, reps: 7, date: daysAgo(27) },
    { weight: 225, reps: 4, date: daysAgo(20) },
    { weight: 215, reps: 6, date: daysAgo(13) },
    { weight: 235, reps: 3, date: daysAgo(6) },
    { weight: 225, reps: 5, date: daysAgo(2) },
  ]},
  // Deadlift — ~100 days
  { exercise: 'Deadlift', sets: [
    { weight: 185, reps: 8, date: daysAgo(105) },
    { weight: 205, reps: 5, date: daysAgo(98) },
    { weight: 205, reps: 6, date: daysAgo(91) },
    { weight: 225, reps: 5, date: daysAgo(84) },
    { weight: 215, reps: 6, date: daysAgo(77) },
    { weight: 245, reps: 3, date: daysAgo(70) },
    { weight: 225, reps: 6, date: daysAgo(63) },
    { weight: 245, reps: 4, date: daysAgo(56) },
    { weight: 235, reps: 5, date: daysAgo(49) },
    { weight: 255, reps: 3, date: daysAgo(42) },
    { weight: 245, reps: 5, date: daysAgo(35) },
    { weight: 265, reps: 3, date: daysAgo(28) },
    { weight: 245, reps: 6, date: daysAgo(21) },
    { weight: 275, reps: 2, date: daysAgo(14) },
    { weight: 255, reps: 5, date: daysAgo(7) },
    { weight: 285, reps: 2, date: daysAgo(2) },
  ]},
  // Overhead Press — ~90 days
  { exercise: 'Overhead Press', sets: [
    { weight: 65, reps: 10, date: daysAgo(100) },
    { weight: 75, reps: 8, date: daysAgo(93) },
    { weight: 75, reps: 8, date: daysAgo(86) },
    { weight: 85, reps: 6, date: daysAgo(79) },
    { weight: 80, reps: 8, date: daysAgo(72) },
    { weight: 85, reps: 7, date: daysAgo(65) },
    { weight: 90, reps: 5, date: daysAgo(58) },
    { weight: 85, reps: 8, date: daysAgo(51) },
    { weight: 95, reps: 4, date: daysAgo(44) },
    { weight: 85, reps: 10, date: daysAgo(37) },
    { weight: 95, reps: 5, date: daysAgo(30) },
    { weight: 95, reps: 6, date: daysAgo(23) },
    { weight: 100, reps: 4, date: daysAgo(16) },
    { weight: 95, reps: 7, date: daysAgo(9) },
    { weight: 105, reps: 3, date: daysAgo(3) },
  ]},
  // Barbell Row — ~80 days
  { exercise: 'Barbell Row', sets: [
    { weight: 95, reps: 10, date: daysAgo(95) },
    { weight: 115, reps: 8, date: daysAgo(88) },
    { weight: 115, reps: 8, date: daysAgo(81) },
    { weight: 125, reps: 6, date: daysAgo(74) },
    { weight: 125, reps: 8, date: daysAgo(67) },
    { weight: 135, reps: 5, date: daysAgo(60) },
    { weight: 125, reps: 10, date: daysAgo(53) },
    { weight: 135, reps: 6, date: daysAgo(46) },
    { weight: 135, reps: 7, date: daysAgo(39) },
    { weight: 145, reps: 5, date: daysAgo(32) },
    { weight: 135, reps: 8, date: daysAgo(25) },
    { weight: 145, reps: 6, date: daysAgo(18) },
    { weight: 155, reps: 4, date: daysAgo(11) },
    { weight: 145, reps: 8, date: daysAgo(4) },
  ]},
]

const SAMPLE_WEIGHTS = [
  // ~120 days of weigh-ins, ~2x per week, gradual cut from 185 to 172
  { weight: 185.0, date: daysAgo(120) },
  { weight: 184.5, date: daysAgo(116) },
  { weight: 185.5, date: daysAgo(112) },
  { weight: 184.0, date: daysAgo(109) },
  { weight: 183.5, date: daysAgo(105) },
  { weight: 184.0, date: daysAgo(101) },
  { weight: 183.0, date: daysAgo(98) },
  { weight: 182.5, date: daysAgo(94) },
  { weight: 183.0, date: daysAgo(91) },
  { weight: 182.0, date: daysAgo(87) },
  { weight: 181.5, date: daysAgo(84) },
  { weight: 182.0, date: daysAgo(80) },
  { weight: 181.0, date: daysAgo(77) },
  { weight: 180.5, date: daysAgo(73) },
  { weight: 180.0, date: daysAgo(70) },
  { weight: 179.5, date: daysAgo(66) },
  { weight: 180.0, date: daysAgo(63) },
  { weight: 179.0, date: daysAgo(59) },
  { weight: 178.5, date: daysAgo(56) },
  { weight: 178.0, date: daysAgo(52) },
  { weight: 178.5, date: daysAgo(49) },
  { weight: 177.5, date: daysAgo(45) },
  { weight: 177.0, date: daysAgo(42) },
  { weight: 176.5, date: daysAgo(38) },
  { weight: 177.0, date: daysAgo(35) },
  { weight: 176.0, date: daysAgo(31) },
  { weight: 175.5, date: daysAgo(28) },
  { weight: 175.0, date: daysAgo(24) },
  { weight: 175.5, date: daysAgo(21) },
  { weight: 174.5, date: daysAgo(17) },
  { weight: 174.0, date: daysAgo(14) },
  { weight: 173.5, date: daysAgo(10) },
  { weight: 174.0, date: daysAgo(7) },
  { weight: 173.0, date: daysAgo(4) },
  { weight: 172.5, date: daysAgo(1) },
]

function finish(sampleData: boolean) {
  localStorage.setItem('onboarding-complete', 'true')
  if (sampleData) {
    localStorage.setItem('sample-data', 'true')
  }
  emit('complete')
}

function chooseEmpty() {
  finish(false)
}

function chooseStarter() {
  for (const ex of STARTER_EXERCISES) {
    workoutStore.addExercise(ex.name, ex.tags)
  }
  finish(false)
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
  finish(true)
}
</script>

<style scoped>
.obScreen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80svh;
  padding: 20px;
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
  gap: 14px;
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
</style>
