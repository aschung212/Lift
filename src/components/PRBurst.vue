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
      </div>

      <div class="prBurstHint" aria-hidden="true">Tap to dismiss</div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, ref, onMounted } from 'vue'
import { usePRBurst } from '../composables/usePRBurst'
import { useTheme } from '../composables/useTheme'

const { visible, payload, presentPRBurst, dismissPRBurst } = usePRBurst()
const { weightUnit, displayWeight } = useTheme()

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
  .prBurstFirstBadge {
    animation: none !important;
  }
  .prBurst-enter-active,
  .prBurst-leave-active { transition: none; }
}
</style>
