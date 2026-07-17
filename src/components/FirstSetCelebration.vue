<!--
  First-set celebration (#762) — a lightweight, auto-dismissing card shown the
  first time a brand-new user logs a set. Their activation moment is the first
  logged set, not their first PR (which the heavier PRBurst handles weeks later).

  Deliberately gentle vs. PRBurst: a centered card with a checkmark mark, a short
  congratulatory line, and a tap/Escape (or auto) dismiss — not a full takeover.
-->
<template>
  <Transition name="firstSet">
    <div
      v-if="visible"
      class="firstSet"
      role="dialog"
      aria-modal="true"
      aria-label="First set logged"
      tabindex="-1"
      @click="onDismiss"
      @keydown.escape="onDismiss"
    >
      <div class="firstSetBackdrop" aria-hidden="true"></div>

      <div class="firstSetCard">
        <div class="firstSetMark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path class="firstSetCheck" d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div class="firstSetEyebrow">🎉 First Set Logged</div>
        <div class="firstSetTitle">You're on your way</div>
        <div class="firstSetSubtitle">Every rep from here builds your record. Keep going.</div>
      </div>

      <div class="firstSetHint" aria-hidden="true">Tap to dismiss</div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { watch, nextTick } from 'vue'
import { useFirstSetCelebration } from '../composables/useFirstSetCelebration'

const { visible, dismissFirstSetCelebration } = useFirstSetCelebration()

function onDismiss(): void {
  dismissFirstSetCelebration()
}

// Focus the root on present so Escape-to-dismiss works without a prior focus.
watch(visible, async (v) => {
  if (v) {
    await nextTick()
    ;(document.querySelector('.firstSet') as HTMLElement | null)?.focus()
  }
})
</script>

<style scoped>
.firstSet {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  outline: none;
  cursor: pointer;
}

.firstSetBackdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 90% 70% at 50% 48%, var(--accent-subtle, rgba(212, 175, 55, 0.12)) 0%, transparent 70%),
    rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px) saturate(0.7) brightness(0.4);
  -webkit-backdrop-filter: blur(8px) saturate(0.7) brightness(0.4);
  pointer-events: none;
}

/* Reduce Transparency (LIFT-680): swap the blur for a near-opaque dim. */
@media (prefers-reduced-transparency: reduce) {
  .firstSetBackdrop {
    background:
      radial-gradient(ellipse 90% 70% at 50% 48%, var(--accent-subtle, rgba(212, 175, 55, 0.12)) 0%, transparent 70%),
      rgba(0, 0, 0, 0.92);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.firstSetCard {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 24px;
  max-width: 320px;
  transform: translateY(-2vh);
}

.firstSetMark {
  width: 72px;
  height: 72px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--accent);
  background: var(--accent-subtle, rgba(212, 175, 55, 0.12));
  box-shadow: 0 0 40px var(--accent-subtle, rgba(212, 175, 55, 0.30));
  animation: firstSetMarkPop 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.firstSetMark svg {
  width: 36px;
  height: 36px;
}

.firstSetCheck {
  stroke-dasharray: 28;
  stroke-dashoffset: 28;
  animation: firstSetCheckDraw 420ms ease-out forwards;
  animation-delay: 220ms;
}

.firstSetEyebrow {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 12px;
}

.firstSetTitle {
  font-family: -apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--accent);
  text-shadow: 0 0 32px var(--accent-subtle, rgba(212, 175, 55, 0.30));
  margin-bottom: 12px;
}

.firstSetSubtitle {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--text-secondary);
}

.firstSetHint {
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

@keyframes firstSetMarkPop {
  from { transform: scale(0.4); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

@keyframes firstSetCheckDraw {
  to { stroke-dashoffset: 0; }
}

/* Overall fade in/out (vue <Transition>). */
.firstSet-enter-active { transition: opacity 200ms ease-out; }
.firstSet-leave-active { transition: opacity 200ms ease-in; }
.firstSet-enter-from,
.firstSet-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .firstSetMark,
  .firstSetCheck {
    animation: none !important;
    stroke-dashoffset: 0;
  }
  .firstSet-enter-active,
  .firstSet-leave-active { transition: none; }
}
</style>
