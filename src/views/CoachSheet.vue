<template>
  <Teleport to="body">
    <div
      class="repMaxOverlay coachOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coachSheetTitle"
      @click.self="close"
      @keydown.escape="close"
    >
      <div class="repMaxModal coachSheet">
        <header class="coachHeader">
          <div class="coachHeaderText">
            <h2 id="coachSheetTitle" class="coachTitle">Weekly Review</h2>
            <p class="coachSub">{{ quotaLabel }}</p>
          </div>
          <button class="coachClose" @click="close" aria-label="Close weekly review">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <!-- pick / idle -->
        <div v-if="coach.state.value === 'idle'" class="coachBody">
          <p class="coachIntro">
            A quick, AI-written read of your recent training — what's progressing, where your
            volume sits, how consistent you've been, and the single thing to focus on next.
          </p>
          <button
            class="coachPrimaryBtn"
            :disabled="!canGenerate"
            @click="generate"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>
            Generate review
          </button>
          <p v-if="!canGenerate" class="coachHint">{{ disabledReason }}</p>
        </div>

        <!-- loading -->
        <div v-else-if="coach.state.value === 'loading'" class="coachBody">
          <p class="coachStatus" role="status" aria-live="polite">
            <span class="coachStatusDot" aria-hidden="true"></span>
            Reading your training and writing your review…
          </p>
          <SkeletonLoader :rows="3" />
        </div>

        <!-- result -->
        <div v-else-if="coach.state.value === 'result' && coach.review.value" class="coachBody">
          <p class="coachHeadline">{{ coach.review.value.headline }}</p>
          <div
            v-for="(section, i) in coach.review.value.sections"
            :key="i"
            class="coachSection wtPrTargets"
          >
            <div class="coachSectionHead">
              <span class="coachSectionTag">{{ sectionLabel(section.type) }}</span>
              <span v-if="section.metric" class="coachSectionMetric">
                {{ section.metric.label }} <strong>{{ section.metric.value }}</strong>
              </span>
            </div>
            <p class="coachSectionTitle">{{ section.title }}</p>
            <p class="coachSectionBody">{{ section.body }}</p>
          </div>
          <div v-if="coach.review.value.focusNext" class="coachFocus">
            <span class="coachFocusTag">Focus next</span>
            <p class="coachFocusBody">{{ coach.review.value.focusNext }}</p>
          </div>
          <button class="coachSecondaryBtn" @click="close">Done</button>
        </div>

        <!-- error / quota -->
        <div v-else class="coachBody">
          <div class="coachError">
            <svg class="coachErrorIcon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p class="coachErrorMsg">{{ errorMessage }}</p>
          </div>
          <button
            v-if="coach.errorKind.value === 'quota_exceeded'"
            class="coachSecondaryBtn"
            @click="close"
          >Got it</button>
          <button
            v-else-if="coach.errorRetryable.value"
            class="coachPrimaryBtn"
            @click="generate"
          >Try again</button>
          <button v-else class="coachSecondaryBtn" @click="close">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import { useModal } from '../composables/useModal'
import { useCoach } from '../composables/useCoach'
import { useAnalytics } from '../composables/useAnalytics'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { useProgressionStore } from '../stores/progression'
import { useWeightUnit } from '../composables/useWeightUnit'
import { buildCoachPayload, type ExerciseOverload } from '../lib/coachDigest'
import type { CoachSectionType } from '../lib/aiCoach'
import { todayISO } from '../lib/dates'
import { isPreviewMode } from '../lib/supabase'

const emit = defineEmits<{ (e: 'close'): void }>()

// Own the scroll lock + focus trap (#830). focusContainer so the dialog itself
// takes focus on open rather than the primary button (no text inputs here, but
// keeps the open consistent with the other top-anchored modals).
const { open: activateModal, close: deactivateModal } = useModal({
  selector: '.coachSheet',
  focusContainer: true,
})

const coach = useCoach()
const { logEvent } = useAnalytics()
const store = useWorkoutStore()
const bodyweightStore = useBodyweightStore()
const progressionStore = useProgressionStore()
const { weightUnit, displayWeight } = useWeightUnit()

const canGenerate = computed(() => !isPreviewMode.value)
const disabledReason = computed(() =>
  isPreviewMode.value ? 'Coach is unavailable on preview builds.' : '',
)

const quotaLabel = computed(() => {
  const n = coach.remaining.value
  if (n === null) return 'AI-written, once a week'
  if (n <= 0) {
    const days = coach.resetDays.value
    return days && days > 0 ? `Resets in ${days} ${days === 1 ? 'day' : 'days'}` : 'No reviews left'
  }
  return `${n} ${n === 1 ? 'review' : 'reviews'} left this week`
})

const SECTION_LABELS: Record<CoachSectionType, string> = {
  progress: 'Progress',
  volume: 'Volume',
  consistency: 'Consistency',
  focus: 'Focus',
}
function sectionLabel(type: CoachSectionType): string {
  return SECTION_LABELS[type] ?? 'Note'
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Sign in to get your weekly review.',
  email_unverified: 'Verify your email to use Coach.',
  consent_required: "You'll need to accept the Coach privacy terms before your training is reviewed.",
  paused: 'Coach is resting for today — try again tomorrow.',
  disabled: "Coach isn't available right now.",
  too_large: 'Your training history is too large to review right now.',
  insufficient: 'Log a bit more training first — Coach needs a couple of sessions to work from.',
  bad_output: 'Something went wrong writing your review. Try again.',
  unavailable: 'Coach couldn’t produce a review this time. Try again.',
  timeout: 'That took too long. Try again.',
  network: 'You appear to be offline. Try again when you’re connected.',
  unknown: 'Something went wrong. Try again.',
}
const errorMessage = computed(() => {
  const kind = coach.errorKind.value
  if (kind === 'quota_exceeded') {
    const days = coach.resetDays.value
    return days && days > 0
      ? `You're out of reviews this week. Resets in ${days} ${days === 1 ? 'day' : 'days'}.`
      : "You're out of reviews this week."
  }
  return (kind && ERROR_MESSAGES[kind]) || ERROR_MESSAGES.unknown
})

function buildPayload() {
  const overloads: ExerciseOverload[] = store.exercises.map((ex) => ({
    exerciseName: ex.name,
    suggestion: store.getOverloadSuggestion(ex.id, todayISO()),
  }))
  return buildCoachPayload({
    exercises: store.exercises,
    bodyweightEntries: bodyweightStore.entries,
    overloads,
    weightUnit: weightUnit.value,
    weeklyTarget: progressionStore.weeklyTarget,
    streakWeeks: progressionStore.streakWeeks,
    toDisplayUnits: (lb) => displayWeight(lb),
  })
}

async function generate() {
  if (!canGenerate.value) return
  // Analytics carry only types/counts — never insight text or exercise names.
  logEvent('coach_review_requested', { sets: store.exercises.reduce((n, e) => n + e.sets.length, 0) })
  const payload = buildPayload()
  await coach.generate(payload)
  if (coach.state.value === 'result') {
    logEvent('coach_review_succeeded', { sections: coach.review.value?.sections.length ?? 0 })
  } else if (coach.state.value === 'error') {
    logEvent('coach_review_failed', { kind: coach.errorKind.value ?? 'unknown' })
  }
}

function close() {
  emit('close')
}

onMounted(() => {
  coach.reset()
  activateModal()
  logEvent('coach_opened', {})
})
onUnmounted(() => {
  deactivateModal()
})
</script>

<style scoped>
.coachSheet {
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.coachHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.coachTitle {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--font-title2);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.coachSub {
  margin: 4px 0 0;
  font-family: var(--ff);
  font-weight: 500;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
}

.coachClose {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  margin: -8px -8px 0 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.coachClose:active {
  background: var(--bg-elevated);
}

.coachBody {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.coachIntro {
  margin: 0;
  font-family: var(--ff);
  font-size: var(--font-callout);
  line-height: 1.5;
  color: var(--text-secondary);
}

.coachPrimaryBtn,
.coachSecondaryBtn {
  min-height: 48px;
  border-radius: 14px;
  font-family: var(--ff);
  font-weight: 700;
  font-size: var(--font-callout);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.coachPrimaryBtn {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
}

.coachPrimaryBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.coachSecondaryBtn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
}

.coachHint {
  margin: -4px 0 0;
  font-family: var(--ff);
  font-size: var(--font-footnote);
  color: var(--text-muted);
  text-align: center;
}

.coachStatus {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--ff);
  font-size: var(--font-callout);
  color: var(--text-secondary);
}

.coachStatusDot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  animation: coachPulse 1.2s ease-in-out infinite;
}

@keyframes coachPulse {
  0%, 100% { opacity: 0.35; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
}

.coachHeadline {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--font-title3);
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.coachSection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}

.coachSectionHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.coachSectionTag {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

.coachSectionMetric {
  font-family: var(--ff);
  font-size: var(--font-footnote);
  color: var(--text-secondary);
}

.coachSectionTitle {
  margin: 0;
  font-family: var(--ff);
  font-weight: 600;
  font-size: var(--font-callout);
  color: var(--text-primary);
}

.coachSectionBody {
  margin: 0;
  font-family: var(--ff);
  font-size: var(--font-footnote);
  line-height: 1.5;
  color: var(--text-secondary);
}

.coachFocus {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 16px;
  background: var(--accent-subtle, var(--bg-elevated));
  border: 1px solid var(--accent);
}

.coachFocusTag {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

.coachFocusBody {
  margin: 0;
  font-family: var(--ff);
  font-weight: 500;
  font-size: var(--font-callout);
  line-height: 1.45;
  color: var(--text-primary);
}

.coachError {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 12px 8px;
  color: var(--text-secondary);
}

.coachErrorIcon {
  color: var(--text-muted);
}

.coachErrorMsg {
  margin: 0;
  font-family: var(--ff);
  font-size: var(--font-callout);
  line-height: 1.5;
  color: var(--text-secondary);
}
</style>
