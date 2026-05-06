<template>
  <!-- Step 1: Explainer -->
  <template v-if="step === 'explainer'">
    <div class="spfTitle">Theme Progression</div>

    <!-- Visual progression preview -->
    <div class="spfPreview" aria-hidden="true">
      <div class="spfProgressTrack">
        <div class="spfProgressFill"></div>
        <div
          v-for="dot in previewDots"
          :key="dot.id"
          class="spfProgressDot"
          :class="{ unlocked: true }"
          :style="{
            left: dot.position + '%',
            background: 'linear-gradient(135deg, ' + dot.accent + ', ' + dot.bg + ')',
            animationDelay: dot.delay + 's',
          }"
        >
          <svg class="spfLockIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
      </div>
      <div class="spfPreviewLabel">
        <span class="spfXPBadge">+{{ XP_CONFIG.newExerciseFlatXP }} XP</span>
        per set
      </div>
    </div>

    <div class="spfExplainer">
      <div class="spfExplainerRow">Every set you log earns XP</div>
      <div class="spfExplainerRow">Hit PRs for bonus multipliers</div>
      <div class="spfExplainerRow">Earn enough XP to unlock new themes</div>
      <div class="spfExplainerRow">Build streaks for even more XP</div>
    </div>
    <button class="spfPrimary" @click="goToPick">Pick a Starter Theme</button>
    <button v-if="showSkip" class="spfSecondary" @click="skipFlow('explainer')">Skip — I'll use the defaults</button>
  </template>

  <!-- Step 2: Starter pick -->
  <template v-else-if="step === 'pick'">
    <div class="spfTitle">Pick Your Starter</div>
    <div class="spfSubtext">Try all three freely until you log your first set. Then your choice locks in.</div>
    <div class="spfGrid">
      <button
        v-for="s in STARTERS"
        :key="s.id"
        :class="['spfCard', { selected: selection === s.id }]"
        @click="selectStarter(s.id)"
      >
        <span
          class="spfDot"
          :style="{ background: 'linear-gradient(135deg, ' + getPreview(s.id).accent + ', ' + getPreview(s.id).bg + ')' }"
        >
          <svg v-if="s.id === 'fire'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 23c-4.97 0-8-3.03-8-7 0-2.5 1.5-5 3-6.5.5-.5 1.37-.18 1.37.54 0 1.3.6 2.46 1.63 3.2.2.14.46-.05.38-.28-.5-1.46-.63-3.1-.08-4.96C11.5 4.5 14 2 16 1c.4-.2.82.18.68.6C15.5 5.5 17 7 18 8.5c2 3 2 5 2 6.5 0 3.97-3.03 8-8 8z"/></svg>
          <svg v-else-if="s.id === 'water'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M2 15c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 19c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 11c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <svg v-else-if="s.id === 'luck'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3C12 3 9 6 9 8.5c0 1.4.7 2.6 1.8 3.2L12 12l1.2-.3C14.3 11.1 15 9.9 15 8.5 15 6 12 3 12 3z"/><path d="M21 12c0 0-3-3-5.5-3-1.4 0-2.6.7-3.2 1.8L12 12l.3 1.2c.6 1.1 1.8 1.8 3.2 1.8C18 15 21 12 21 12z"/><path d="M12 21c0 0 3-3 3-5.5 0-1.4-.7-2.6-1.8-3.2L12 12l-1.2.3C9.7 12.9 9 14.1 9 15.5 9 18 12 21 12 21z"/><path d="M3 12c0 0 3 3 5.5 3 1.4 0 2.6-.7 3.2-1.8L12 12l-.3-1.2C11.1 9.7 9.9 9 8.5 9 6 9 3 12 3 12z"/></svg>
        </span>
        <span class="spfLabel">{{ s.label }}</span>
      </button>
    </div>
    <div class="spfWarning">This choice is semi-permanent. You can change it later, but your progression will reset.</div>
    <button class="spfPrimary" :disabled="!selection" @click="goToGoal">Next</button>
    <button v-if="showSkip" class="spfSecondary" @click="skipFlow('pick')">Skip</button>
  </template>

  <!-- Step 3: Weekly goal -->
  <template v-else>
    <div class="spfTitle">Set Your Weekly Goal</div>
    <div class="spfSubtext">How many days per week do you plan to train? Hit your goal consistently to build a streak and earn bonus XP.</div>
    <div class="spfGoal">
      <div class="iosStepper">
        <button class="iosStepperBtn" @click="goal = Math.max(1, goal - 1)" :disabled="goal <= 1" aria-label="Decrease">−</button>
        <span class="iosStepperValue">{{ goal }} day{{ goal !== 1 ? 's' : '' }}</span>
        <button class="iosStepperBtn" @click="goal = Math.min(7, goal + 1)" :disabled="goal >= 7" aria-label="Increase">+</button>
      </div>
      <div class="spfGoalBonus">{{ bonusLabel }}</div>
      <div class="spfGoalHint">Your streak grows each week you hit this goal. Longer streaks earn even higher bonuses.</div>
      <div class="spfGoalHint">You can increase this later without losing your streak. Decreasing it will reset your streak.</div>
      <div v-if="goal >= 7" class="spfGoalRest">Rest days are critical for recovery. 6 and 7 days earn the same bonus.</div>
    </div>
    <button class="spfPrimary" @click="confirmGoal">Let's Go</button>
    <button class="spfSecondary" @click="step = 'pick'">Back</button>
  </template>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { THEME_PREVIEWS, type ThemeId } from '../composables/useTheme'
import { XP_CONFIG } from '../lib/xp'
import { useAnalytics } from '../composables/useAnalytics'

const props = withDefaults(defineProps<{
  showSkip?: boolean
  resolvedMode?: 'dark' | 'light'
}>(), {
  showSkip: true,
  resolvedMode: 'dark',
})

const emit = defineEmits<{
  confirm: [themeId: ThemeId, weeklyGoal: number]
  skip: []
  preview: [themeId: ThemeId]
  'revert-preview': []
}>()

const { logEvent } = useAnalytics()

const step = ref<'explainer' | 'pick' | 'goal'>('explainer')
const selection = ref<ThemeId | null>(null)
const goal = ref(3)

const STARTERS: { id: ThemeId; label: string }[] = [
  { id: 'fire', label: 'Intensity' },
  { id: 'water', label: 'Flow' },
  { id: 'luck', label: 'Luck' },
]

// Dots for the visual progression preview — shows 5 representative themes along a track
const previewDots = computed(() => {
  const samples: { id: ThemeId; position: number }[] = [
    { id: 'fire', position: 15 },
    { id: 'water', position: 35 },
    { id: 'amethyst', position: 55 },
    { id: 'earth', position: 75 },
    { id: 'eternal', position: 95 },
  ]
  return samples.map((s, i) => {
    const colors = THEME_PREVIEWS[s.id]?.[props.resolvedMode] || THEME_PREVIEWS[s.id]?.dark
    return {
      id: s.id,
      position: s.position,
      accent: colors.accent,
      bg: colors.bg,
      delay: 0.8 + i * 0.6, // staggered unlock animation
    }
  })
})

const bonusLabel = computed(() => {
  const t = goal.value
  if (t >= 6) return 'Initial streak bonus: 1.5× (max)'
  if (t >= 5) return 'Initial streak bonus: 1.3×'
  if (t >= 4) return 'Initial streak bonus: 1.2×'
  if (t >= 3) return 'Initial streak bonus: 1.1×'
  return 'No streak bonus'
})

function getPreview(id: ThemeId) {
  return THEME_PREVIEWS[id]?.[props.resolvedMode] || THEME_PREVIEWS[id]?.dark || { accent: '#888', bg: '#222' }
}

function goToPick() {
  logEvent('onboarding_step', { step: 'explainer_done' })
  step.value = 'pick'
}

function goToGoal() {
  logEvent('onboarding_step', { step: 'pick_done', theme: selection.value })
  step.value = 'goal'
}

function confirmGoal() {
  logEvent('onboarding_step', { step: 'goal_done', goal: goal.value })
  emit('confirm', selection.value!, goal.value)
}

function skipFlow(fromStep: string) {
  logEvent('onboarding_step', { step: 'skip', from: fromStep })
  emit('revert-preview')
  emit('skip')
}

function selectStarter(id: ThemeId) {
  selection.value = id
  emit('preview', id)
}

function reset() {
  step.value = 'explainer'
  selection.value = null
  goal.value = 3
  emit('revert-preview')
}

defineExpose({ reset })
</script>

<style scoped>
.spfTitle {
  font-size: var(--font-title3);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.spfSubtext {
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 24px;
}

.spfExplainer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
  text-align: left;
}

.spfExplainerRow {
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  padding-left: 8px;
  border-left: 3px solid var(--accent);
}

/* --- Visual progression preview --- */

.spfPreview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.spfProgressTrack {
  position: relative;
  width: 100%;
  height: 8px;
  background: var(--card-bg);
  border-radius: 4px;
  overflow: visible;
}

.spfProgressFill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 0%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--text-secondary));
  animation: spfFillBar 3.6s ease-out forwards;
}

@keyframes spfFillBar {
  0% { width: 0%; }
  100% { width: 100%; }
}

.spfProgressDot {
  position: absolute;
  top: 50%;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.spfProgressDot.unlocked {
  animation: spfDotPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes spfDotPop {
  0% { transform: translate(-50%, -50%) scale(0); }
  100% { transform: translate(-50%, -50%) scale(1); }
}

.spfLockIcon {
  width: 12px;
  height: 12px;
  animation: spfLockToUnlock 0.3s ease-out forwards;
  animation-delay: inherit;
}

@keyframes spfLockToUnlock {
  0% { opacity: 0.8; }
  50% { opacity: 0; }
  100% { opacity: 0; }
}

.spfPreviewLabel {
  font-size: var(--font-caption1);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.spfXPBadge {
  font-weight: 700;
  color: var(--accent);
  font-size: var(--font-caption1);
}

.spfGrid {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 24px;
}

.spfCard {
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

.spfDot {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid transparent;
  transition: border-color 0.2s, transform 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-accent);
}

.spfDot svg {
  width: 24px;
  height: 24px;
}

.spfCard.selected .spfDot {
  border-color: var(--accent);
  transform: scale(1.1);
}

.spfLabel {
  font-size: var(--font-caption1);
  font-weight: 600;
  color: var(--text-secondary);
}

.spfCard.selected .spfLabel {
  color: var(--text-primary);
}

.spfWarning {
  font-size: var(--font-caption2);
  color: var(--text-tertiary);
  text-align: center;
  margin-bottom: 16px;
  line-height: 1.4;
}

.spfGoal {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin: 8px 0 16px;
}

.spfGoalBonus {
  font-size: var(--font-subhead);
  font-weight: 600;
  color: var(--accent);
  margin-top: 8px;
}

.spfGoalHint {
  font-size: var(--font-caption2);
  color: var(--text-muted);
  margin-top: 8px;
  line-height: 1.4;
}

.spfGoalRest {
  font-size: var(--font-caption2);
  color: var(--text-muted);
  margin-top: 8px;
  line-height: 1.4;
}

.spfPrimary {
  width: 100%;
  padding: 12px;
  min-height: 44px;
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: 12px;
  font-size: var(--font-callout);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.spfPrimary:disabled {
  opacity: 0.5;
  cursor: default;
}

.spfSecondary {
  width: 100%;
  padding: 12px;
  min-height: 44px;
  margin-top: 8px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: var(--font-callout);
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}
</style>
