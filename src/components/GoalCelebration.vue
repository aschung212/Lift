<!--
  Weekly-goal celebration (LIFT-764) — a lightweight, auto-dismissing banner
  shown the first time the weekly training goal is met each week. Distinct from
  the full-bleed PR burst: this is the quieter, recurring habit-loop reward.

  - Pins below the safe-area inset at the top of the screen
  - Flame icon + headline; "milestone" variant when the streak multiplier bumps
  - Tap anywhere (or press Escape) to dismiss; otherwise auto-dismisses
-->
<template>
  <Transition name="goalCeleb">
    <div
      v-if="visible && payload"
      class="goalCeleb"
      :class="{ goalCelebMilestone: payload.milestone }"
      role="status"
      aria-live="polite"
      @click="onDismiss"
    >
      <span class="goalCelebIcon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.5-2.5 1.5-3.5l1 1Z"/></svg>
      </span>
      <span class="goalCelebText">
        <span class="goalCelebTitle">{{ title }}</span>
        <span class="goalCelebSubtitle">{{ subtitle }}</span>
      </span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useGoalCelebration } from '../composables/useGoalCelebration'

const { visible, payload, presentGoalCelebration, dismissGoalCelebration } = useGoalCelebration()

const title = computed(() => {
  if (!payload.value) return ''
  return payload.value.milestone ? `${payload.value.streak}-week streak!` : 'Weekly goal complete'
})

const subtitle = computed(() => {
  const p = payload.value
  if (!p) return ''
  if (p.milestone) return 'Your streak multiplier just leveled up'
  if (p.streak > 1) return `${p.streak} weeks in a row — keep it going`
  return `${p.target} ${p.target === 1 ? 'day' : 'days'} trained this week`
})

function onDismiss(): void {
  dismissGoalCelebration()
}

// NOTE: this banner deliberately does NOT grab focus. It fires synchronously
// from saveSet, immediately before WorkoutTracker re-focuses the weight input
// for the next set; stealing focus here would drop the iOS keyboard and break
// the settled "fields cleared and auto-focused after save" pattern. As a
// passive role="status" toast it's tap- and auto-dismissed, so it needs none.

// DEV-only trigger so the overlay can be verified without a live goal-hit.
// Stripped from prod by Vite dead-code elimination.
onMounted(() => {
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__presentGoalCelebration = presentGoalCelebration
  }
})
</script>

<style scoped>
.goalCeleb {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 9500;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(92vw, 420px);
  padding: 12px 16px;
  border-radius: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), 0 0 24px var(--accent-subtle, rgba(212, 175, 55, 0.18));
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  /* Comfortable tap target for the whole banner. */
  min-height: 44px;
}

.goalCelebMilestone {
  border-color: var(--accent);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 36px var(--accent-subtle, rgba(212, 175, 55, 0.3));
}

.goalCelebIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent-subtle, rgba(212, 175, 55, 0.16));
  color: var(--accent);
}

.goalCelebMilestone .goalCelebIcon {
  animation: goalIconPop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.goalCelebText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.goalCelebTitle {
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.goalCelebMilestone .goalCelebTitle {
  color: var(--accent);
}

.goalCelebSubtitle {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-secondary);
}

@keyframes goalIconPop {
  from { transform: scale(0.5); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

/* Slide + fade entrance/exit from the top. */
.goalCeleb-enter-active { transition: opacity 220ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.goalCeleb-leave-active { transition: opacity 180ms ease-in, transform 180ms ease-in; }
.goalCeleb-enter-from,
.goalCeleb-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-16px);
}

@media (prefers-reduced-motion: reduce) {
  .goalCelebMilestone .goalCelebIcon { animation: none; }
  .goalCeleb-enter-active,
  .goalCeleb-leave-active { transition: opacity 120ms linear; }
  .goalCeleb-enter-from,
  .goalCeleb-leave-to { transform: translateX(-50%); }
}
</style>
