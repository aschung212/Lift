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
  // Bench Press — ~365 days, mix of working sets and PRs
  { exercise: 'Bench Press', sets: [
    // Early phase (~12-10 months ago)
    { weight: 75, reps: 10, date: daysAgo(360) },
    { weight: 75, reps: 10, date: daysAgo(354) },
    { weight: 85, reps: 8, date: daysAgo(347) },
    { weight: 85, reps: 8, date: daysAgo(340) },
    { weight: 95, reps: 6, date: daysAgo(333) },
    { weight: 85, reps: 10, date: daysAgo(326) },
    { weight: 95, reps: 8, date: daysAgo(319) },
    { weight: 95, reps: 8, date: daysAgo(312) },
    // Building phase (~10-8 months ago)
    { weight: 95, reps: 10, date: daysAgo(305) },
    { weight: 105, reps: 6, date: daysAgo(298) },
    { weight: 95, reps: 10, date: daysAgo(291) },
    { weight: 105, reps: 8, date: daysAgo(284) },
    { weight: 105, reps: 8, date: daysAgo(277) },
    { weight: 115, reps: 5, date: daysAgo(270) },
    { weight: 105, reps: 10, date: daysAgo(263) },
    { weight: 115, reps: 6, date: daysAgo(256) },
    // Intermediate phase (~8-6 months ago)
    { weight: 115, reps: 8, date: daysAgo(249) },
    { weight: 115, reps: 8, date: daysAgo(242) },
    { weight: 125, reps: 5, date: daysAgo(235) },
    { weight: 115, reps: 10, date: daysAgo(228) },
    { weight: 125, reps: 6, date: daysAgo(221) },
    { weight: 125, reps: 7, date: daysAgo(214) },
    { weight: 135, reps: 4, date: daysAgo(207) },
    { weight: 125, reps: 8, date: daysAgo(200) },
    // Plateau and break-through (~6-4 months ago)
    { weight: 135, reps: 5, date: daysAgo(193) },
    { weight: 125, reps: 10, date: daysAgo(186) },
    { weight: 135, reps: 5, date: daysAgo(179) },
    { weight: 135, reps: 6, date: daysAgo(172) },
    { weight: 135, reps: 6, date: daysAgo(165) },
    { weight: 145, reps: 4, date: daysAgo(158) },
    { weight: 135, reps: 8, date: daysAgo(151) },
    { weight: 145, reps: 5, date: daysAgo(144) },
    { weight: 135, reps: 10, date: daysAgo(137) },
    { weight: 145, reps: 5, date: daysAgo(130) },
    { weight: 145, reps: 6, date: daysAgo(123) },
    // Recent phase (~4 months to now — existing data)
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
  // Squat — ~365 days
  { exercise: 'Squat', sets: [
    { weight: 95, reps: 10, date: daysAgo(355) },
    { weight: 95, reps: 10, date: daysAgo(348) },
    { weight: 115, reps: 8, date: daysAgo(341) },
    { weight: 115, reps: 8, date: daysAgo(334) },
    { weight: 125, reps: 6, date: daysAgo(327) },
    { weight: 115, reps: 10, date: daysAgo(320) },
    { weight: 135, reps: 6, date: daysAgo(313) },
    { weight: 135, reps: 8, date: daysAgo(306) },
    { weight: 135, reps: 8, date: daysAgo(299) },
    { weight: 145, reps: 6, date: daysAgo(292) },
    { weight: 135, reps: 10, date: daysAgo(285) },
    { weight: 145, reps: 8, date: daysAgo(278) },
    { weight: 155, reps: 5, date: daysAgo(271) },
    { weight: 145, reps: 8, date: daysAgo(264) },
    { weight: 155, reps: 6, date: daysAgo(257) },
    { weight: 155, reps: 8, date: daysAgo(250) },
    { weight: 165, reps: 5, date: daysAgo(243) },
    { weight: 155, reps: 8, date: daysAgo(236) },
    { weight: 165, reps: 6, date: daysAgo(229) },
    { weight: 175, reps: 5, date: daysAgo(222) },
    { weight: 165, reps: 8, date: daysAgo(215) },
    { weight: 175, reps: 6, date: daysAgo(208) },
    { weight: 175, reps: 6, date: daysAgo(201) },
    { weight: 185, reps: 4, date: daysAgo(194) },
    { weight: 175, reps: 8, date: daysAgo(187) },
    { weight: 185, reps: 5, date: daysAgo(180) },
    { weight: 185, reps: 5, date: daysAgo(173) },
    { weight: 195, reps: 4, date: daysAgo(166) },
    { weight: 185, reps: 6, date: daysAgo(159) },
    { weight: 195, reps: 5, date: daysAgo(152) },
    { weight: 185, reps: 8, date: daysAgo(145) },
    { weight: 195, reps: 5, date: daysAgo(138) },
    { weight: 195, reps: 6, date: daysAgo(131) },
    { weight: 205, reps: 4, date: daysAgo(124) },
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
  // Deadlift — ~365 days
  { exercise: 'Deadlift', sets: [
    { weight: 135, reps: 8, date: daysAgo(350) },
    { weight: 135, reps: 8, date: daysAgo(336) },
    { weight: 155, reps: 6, date: daysAgo(322) },
    { weight: 155, reps: 8, date: daysAgo(308) },
    { weight: 165, reps: 6, date: daysAgo(294) },
    { weight: 175, reps: 5, date: daysAgo(280) },
    { weight: 165, reps: 8, date: daysAgo(266) },
    { weight: 185, reps: 5, date: daysAgo(252) },
    { weight: 185, reps: 5, date: daysAgo(238) },
    { weight: 195, reps: 4, date: daysAgo(224) },
    { weight: 185, reps: 6, date: daysAgo(210) },
    { weight: 205, reps: 3, date: daysAgo(196) },
    { weight: 195, reps: 6, date: daysAgo(182) },
    { weight: 205, reps: 4, date: daysAgo(168) },
    { weight: 205, reps: 5, date: daysAgo(154) },
    { weight: 215, reps: 4, date: daysAgo(140) },
    { weight: 205, reps: 6, date: daysAgo(126) },
    { weight: 225, reps: 3, date: daysAgo(112) },
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
  // Overhead Press — ~365 days
  { exercise: 'Overhead Press', sets: [
    { weight: 45, reps: 10, date: daysAgo(345) },
    { weight: 45, reps: 10, date: daysAgo(331) },
    { weight: 50, reps: 8, date: daysAgo(317) },
    { weight: 55, reps: 8, date: daysAgo(303) },
    { weight: 55, reps: 8, date: daysAgo(289) },
    { weight: 60, reps: 6, date: daysAgo(275) },
    { weight: 55, reps: 10, date: daysAgo(261) },
    { weight: 60, reps: 8, date: daysAgo(247) },
    { weight: 65, reps: 6, date: daysAgo(233) },
    { weight: 60, reps: 10, date: daysAgo(219) },
    { weight: 65, reps: 8, date: daysAgo(205) },
    { weight: 65, reps: 8, date: daysAgo(191) },
    { weight: 70, reps: 6, date: daysAgo(177) },
    { weight: 65, reps: 10, date: daysAgo(163) },
    { weight: 75, reps: 5, date: daysAgo(149) },
    { weight: 70, reps: 8, date: daysAgo(135) },
    { weight: 75, reps: 6, date: daysAgo(121) },
    { weight: 75, reps: 7, date: daysAgo(107) },
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
  // Barbell Row — ~365 days
  { exercise: 'Barbell Row', sets: [
    { weight: 65, reps: 10, date: daysAgo(340) },
    { weight: 65, reps: 10, date: daysAgo(326) },
    { weight: 75, reps: 8, date: daysAgo(312) },
    { weight: 75, reps: 8, date: daysAgo(298) },
    { weight: 85, reps: 6, date: daysAgo(284) },
    { weight: 75, reps: 10, date: daysAgo(270) },
    { weight: 85, reps: 8, date: daysAgo(256) },
    { weight: 85, reps: 8, date: daysAgo(242) },
    { weight: 95, reps: 6, date: daysAgo(228) },
    { weight: 85, reps: 10, date: daysAgo(214) },
    { weight: 95, reps: 8, date: daysAgo(200) },
    { weight: 95, reps: 8, date: daysAgo(186) },
    { weight: 105, reps: 6, date: daysAgo(172) },
    { weight: 95, reps: 10, date: daysAgo(158) },
    { weight: 105, reps: 8, date: daysAgo(144) },
    { weight: 115, reps: 5, date: daysAgo(130) },
    { weight: 105, reps: 8, date: daysAgo(116) },
    { weight: 115, reps: 6, date: daysAgo(102) },
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
  // ~365 days of weigh-ins, ~2x per week
  // Bulk phase: 168 → 190 (~12-4 months ago)
  { weight: 168.0, date: daysAgo(360) },
  { weight: 168.5, date: daysAgo(356) },
  { weight: 169.0, date: daysAgo(352) },
  { weight: 169.5, date: daysAgo(348) },
  { weight: 170.0, date: daysAgo(344) },
  { weight: 169.5, date: daysAgo(340) },
  { weight: 170.5, date: daysAgo(336) },
  { weight: 171.0, date: daysAgo(332) },
  { weight: 171.5, date: daysAgo(328) },
  { weight: 171.0, date: daysAgo(324) },
  { weight: 172.0, date: daysAgo(320) },
  { weight: 172.5, date: daysAgo(316) },
  { weight: 173.0, date: daysAgo(312) },
  { weight: 173.5, date: daysAgo(308) },
  { weight: 173.0, date: daysAgo(304) },
  { weight: 174.0, date: daysAgo(300) },
  { weight: 174.5, date: daysAgo(296) },
  { weight: 175.0, date: daysAgo(292) },
  { weight: 175.5, date: daysAgo(288) },
  { weight: 175.0, date: daysAgo(284) },
  { weight: 176.0, date: daysAgo(280) },
  { weight: 176.5, date: daysAgo(276) },
  { weight: 177.0, date: daysAgo(272) },
  { weight: 177.5, date: daysAgo(268) },
  { weight: 177.0, date: daysAgo(264) },
  { weight: 178.0, date: daysAgo(260) },
  { weight: 178.5, date: daysAgo(256) },
  { weight: 179.0, date: daysAgo(252) },
  { weight: 179.5, date: daysAgo(248) },
  { weight: 180.0, date: daysAgo(244) },
  { weight: 180.5, date: daysAgo(240) },
  { weight: 180.0, date: daysAgo(236) },
  { weight: 181.0, date: daysAgo(232) },
  { weight: 181.5, date: daysAgo(228) },
  { weight: 182.0, date: daysAgo(224) },
  { weight: 182.5, date: daysAgo(220) },
  { weight: 182.0, date: daysAgo(216) },
  { weight: 183.0, date: daysAgo(212) },
  { weight: 183.5, date: daysAgo(208) },
  { weight: 184.0, date: daysAgo(204) },
  { weight: 184.5, date: daysAgo(200) },
  { weight: 185.0, date: daysAgo(196) },
  { weight: 185.5, date: daysAgo(192) },
  { weight: 186.0, date: daysAgo(188) },
  { weight: 186.5, date: daysAgo(184) },
  { weight: 186.0, date: daysAgo(180) },
  { weight: 187.0, date: daysAgo(176) },
  { weight: 187.5, date: daysAgo(172) },
  { weight: 188.0, date: daysAgo(168) },
  { weight: 188.5, date: daysAgo(164) },
  { weight: 188.0, date: daysAgo(160) },
  { weight: 189.0, date: daysAgo(156) },
  { weight: 189.5, date: daysAgo(152) },
  { weight: 190.0, date: daysAgo(148) },
  { weight: 190.5, date: daysAgo(144) },
  { weight: 190.0, date: daysAgo(140) },
  { weight: 189.5, date: daysAgo(136) },
  { weight: 189.0, date: daysAgo(132) },
  { weight: 188.0, date: daysAgo(128) },
  { weight: 187.0, date: daysAgo(124) },
  // Cut phase: 185 → 172 (~4 months to now — existing data)
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
