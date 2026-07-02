<!--
  PR burst celebration — full-bleed takeover shown when the user logs a
  genuine e1RM PR. Layout matches design_handoff_lift_ios_pwa/screens/08-pr-burst.png:

  - Dim + radial-overlay backdrop (vignette + gold accent radial)
  - SVG ring echoes that expand from r=0
  - Eyebrow "🏆 PERSONAL RECORD"
  - Large delta "+XX lbs" (84px / 800)
  - Subtitle "oldE1RM → newE1RM lbs e1RM"
  - Chip "Exercise · weight × reps"
  - "Tap to dismiss" hint at the bottom

  Tapping anywhere (or pressing Escape) dismisses.
-->
<template>
  <Transition name="prBurst">
    <div
      v-if="visible && payload"
      class="prBurst"
      role="dialog"
      aria-modal="true"
      aria-label="Personal record"
      tabindex="-1"
      @click="onDismiss"
      @keydown.escape="onDismiss"
    >
      <!-- Dimmed + radial backdrop -->
      <div class="prBurstBackdrop" aria-hidden="true"></div>

      <!-- Ring echoes (pointer-events: none) -->
      <svg class="prBurstRings" viewBox="0 0 360 360" aria-hidden="true">
        <circle cx="180" cy="180" r="80" fill="none" stroke="currentColor" stroke-width="2" opacity="0.35" class="prRing prRing1" />
        <circle cx="180" cy="180" r="130" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2" class="prRing prRing2" />
        <circle cx="180" cy="180" r="170" fill="none" stroke="currentColor" stroke-width="1" opacity="0.12" class="prRing prRing3" />
      </svg>

      <div class="prBurstContent">
        <div v-if="payload?.isFirstPR" class="prBurstFirstBadge">Your First</div>
        <div class="prBurstEyebrow">🏆 Personal Record</div>
        <div class="prBurstDelta">+{{ deltaDisplay }} {{ unit }}</div>
        <div class="prBurstSubtitle">
          <span class="prBurstSubtitleOld">{{ oldDisplay }}</span>
          <span class="prBurstSubtitleArrow"> → </span>
          <span class="prBurstSubtitleNew">{{ newDisplay }}</span>
          <span class="prBurstSubtitleUnit"> {{ unit }} e1RM</span>
        </div>
        <div class="prBurstChip">
          {{ payload.exerciseName }} · {{ setDisplay }}
        </div>

        <!-- Peak-moment share affordance (#716): one tap opens the share sheet
             pre-selected to the PR card. Stop propagation so the surrounding
             tap-to-dismiss doesn't fire. -->
        <button type="button" class="prBurstShare" @click.stop="onShareThisPR">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>
          Share this PR
        </button>
      </div>

      <div class="prBurstHint" aria-hidden="true">Tap to dismiss</div>
    </div>
  </Transition>

  <Teleport to="body">
    <SharePickerSheet
      v-if="pickerOpen && shareSummary"
      :summary="shareSummary"
      initial-card-id="pr-focus"
      @close="closePicker"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, ref, onMounted, defineAsyncComponent } from 'vue'
import { usePRBurst } from '../composables/usePRBurst'
import { useModal } from '../composables/useModal'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useWorkoutStore } from '../stores/workout'
import { useProgressionStore } from '../stores/progression'
import { useAnalytics } from '../composables/useAnalytics'
import { buildSessionSummary, type SessionSummary } from '../lib/sessionSummary'

const SharePickerSheet = defineAsyncComponent(() => import('./share/SharePickerSheet.vue'))

const { visible, payload, presentPRBurst, dismissPRBurst } = usePRBurst()
const { weightUnit, displayWeight } = useWeightUnit()
const workoutStore = useWorkoutStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()

// ── "Share this PR" peak-moment flow (#716) ───────────────────────────────
const shareSummary = ref<SessionSummary | null>(null)

// The burst is dismissed before the picker opens, so there's no parent modal
// to own the share sheet's scroll-lock / Escape (SharePickerSheet uses
// lockScroll:false and delegates Escape to its parent). useModal owns both
// here — no focus trap (selector omitted) since SharePickerSheet traps its own
// '.spOverlay'. This replaces the hand-rolled listener boilerplate (LIFT-878).
const { isOpen: pickerOpen, open: openPicker, close: closePickerModal } = useModal({
  onEscape: () => closePickerModal(),
  onClose: () => {
    shareSummary.value = null
  },
})

/** Local calendar date (YYYY-MM-DD), matching WorkoutTracker.todayISO(). */
function localTodayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function onShareThisPR(): void {
  const p = payload.value
  if (!p) return
  // Build the session summary for the PR's day so the share sheet (pre-selected
  // to the PR card) renders the right numbers. The set is already persisted by
  // the time the burst shows, so the summary reflects it.
  shareSummary.value = buildSessionSummary({
    rawDate: p.rawDate ?? localTodayKey(),
    exercises: workoutStore.exercises,
    xpPerSet: progressionStore.xpPerSet,
    streakWeeks: progressionStore.streakWeeks,
    toDisplayUnits: displayWeight,
    unitLabel: weightUnit.value,
  })
  logEvent('pr_share_opened', {
    exercise: p.exerciseName,
    firstPr: p.isFirstPR === true,
  })
  openPicker()
  // Hand off from the celebration to the share sheet — dismiss the burst so the
  // two overlays don't stack (the picker sits at a lower z-index by design).
  dismissPRBurst()
}

function closePicker(): void {
  closePickerModal()
}

// DEV-only: expose the trigger on window so we can visually verify the overlay
// from Playwright/DevTools without needing a live PR. Stripped from prod builds
// by Vite's dead-code elimination (import.meta.env.DEV is false in prod).
onMounted(() => {
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__presentPRBurst = presentPRBurst
  }
})

const unit = computed(() => weightUnit.value)

const deltaDisplay = computed(() => {
  if (!payload.value) return '0'
  const delta = payload.value.newE1RM - payload.value.oldE1RM
  const shown = displayWeight(delta)
  // Whole pounds / kg read better than 12.3 lbs for the big hero number.
  return Number.isInteger(shown) ? String(shown) : shown.toFixed(1)
})

const oldDisplay = computed(() => {
  if (!payload.value) return ''
  return Math.round(displayWeight(payload.value.oldE1RM))
})

const newDisplay = computed(() => {
  if (!payload.value) return ''
  return Math.round(displayWeight(payload.value.newE1RM))
})

const setDisplay = computed(() => {
  if (!payload.value) return ''
  const w = displayWeight(payload.value.setWeight)
  return `${Number.isInteger(w) ? w : w.toFixed(1)} × ${payload.value.setReps}`
})

function onDismiss() {
  dismissPRBurst()
}

// Keyboard focus on present so the Escape-to-dismiss works without needing
// a prior focus. The tabindex="-1" on the root makes this valid.
const rootEl = ref<HTMLElement | null>(null)
watch(visible, async (v) => {
  if (v) {
    await nextTick()
    const root = document.querySelector('.prBurst') as HTMLElement | null
    rootEl.value = root
    root?.focus()
  }
})
</script>

<style scoped>
.prBurst {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  /* Outline on focus is noisy for a celebration — keep it invisible but focusable. */
  outline: none;
  cursor: pointer;
}

.prBurstBackdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 90% 70% at 50% 48%, var(--accent-subtle, rgba(212, 175, 55, 0.12)) 0%, transparent 70%),
    radial-gradient(ellipse 120% 120% at 50% 48%, transparent 35%, rgba(0, 0, 0, 0.85) 100%),
    rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px) saturate(0.7) brightness(0.35);
  -webkit-backdrop-filter: blur(8px) saturate(0.7) brightness(0.35);
  pointer-events: none;
}

/* Reduce Transparency (LIFT-680): swap the blur for a near-opaque dim so the
   celebration still reads but the busy app behind it isn't shown through glass. */
@media (prefers-reduced-transparency: reduce) {
  .prBurstBackdrop {
    background:
      radial-gradient(ellipse 90% 70% at 50% 48%, var(--accent-subtle, rgba(212, 175, 55, 0.12)) 0%, transparent 70%),
      rgba(0, 0, 0, 0.92);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.prBurstRings {
  position: absolute;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 360px;
  height: 360px;
  max-width: 90vw;
  max-height: 90vw;
  pointer-events: none;
  color: var(--accent);
}

.prBurstContent {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 24px;
  max-width: 360px;
  /* Anchor content slightly above vertical center, matching the ring echoes. */
  transform: translateY(-2vh);
}

.prBurstFirstBadge {
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--accent);
  text-shadow: 0 0 32px var(--accent-subtle, rgba(212, 175, 55, 0.40));
  margin-bottom: 4px;
  animation: prFirstBadgePop 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: 60ms;
}

.prBurstEyebrow {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 16px;
}

.prBurstDelta {
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 84px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--accent);
  text-shadow: 0 0 40px var(--accent-subtle, rgba(212, 175, 55, 0.30));
  font-variant-numeric: tabular-nums;
  margin-bottom: 12px;
}

.prBurstSubtitle {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  margin-bottom: 24px;
}

.prBurstSubtitleNew {
  color: var(--accent);
  font-weight: 700;
}

.prBurstChip {
  display: inline-block;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 99px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.prBurstShare {
  margin-top: 24px;
  min-height: 48px;
  padding: 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
  border-radius: 99px;
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 0 32px var(--accent-subtle, rgba(212, 175, 55, 0.30));
  animation: prShareIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: 220ms;
}

@keyframes prShareIn {
  from { transform: scale(0.8); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.prBurstHint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(44px + env(safe-area-inset-bottom, 0px));
  text-align: center;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Ring echo entrance: scale from 0 to 1 with stagger. */
.prRing {
  transform-origin: 180px 180px;
  animation: prRingIn 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.prRing1 { animation-delay: 0ms; }
.prRing2 { animation-delay: 80ms; }
.prRing3 { animation-delay: 160ms; }

@keyframes prRingIn {
  from { transform: scale(0); opacity: 0; }
  to   { transform: scale(1); }
}

/* Overall fade in/out (vue <Transition>). */
.prBurst-enter-active { transition: opacity 180ms ease-out; }
.prBurst-leave-active { transition: opacity 180ms ease-in; }
.prBurst-enter-from,
.prBurst-leave-to { opacity: 0; }

/* Delta number: slight "pop" on entrance. */
.prBurstDelta {
  animation: prDeltaPop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: 120ms;
}
@keyframes prDeltaPop {
  from { transform: scale(0.6); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

@keyframes prFirstBadgePop {
  from { transform: scale(0.4) translateY(8px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .prRing,
  .prBurstDelta,
  .prBurstFirstBadge,
  .prBurstShare {
    animation: none !important;
  }
  .prBurst-enter-active,
  .prBurst-leave-active { transition: none; }
}
</style>
