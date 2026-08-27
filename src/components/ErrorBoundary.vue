<template>
  <slot v-if="!error"></slot>
  <div v-else class="errorBoundary" role="alert">
    <div class="errorBoundaryIcon">!</div>
    <h2 class="errorBoundaryTitle">Something went wrong</h2>
    <p class="errorBoundaryMessage">{{ error.message }}</p>
    <p v-if="reloadSuppressed" class="errorBoundaryMessage errorBoundaryHint">
      Reloading didn't clear the problem. Fully close and reopen Lift to try a
      fresh start.
    </p>
    <div class="errorBoundaryActions">
      <button
        v-if="canSoftRetry"
        class="errorBoundaryBtn errorBoundaryBtnSecondary"
        @click="tryAgain"
      >
        Try again
      </button>
      <button class="errorBoundaryBtn" @click="reload">Reload</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onErrorCaptured } from 'vue'
import { logError } from '../lib/logger'
import { guardedReload } from '../lib/reloadGuard'

const error = ref<Error | null>(null)

// A soft "Try again" merely clears the error flag and re-renders the same
// subtree. That only helps a genuinely transient error; a deterministic one
// (a corrupt persisted value poisoning a render, a bad theme id) re-throws
// immediately, and clearing the flag again would trap the user in a
// fallback↔crash flicker with no way out. So we allow the soft path exactly
// once: after one failed soft recovery, offer only the hard reload, which
// re-runs the boot-time IDB-restore / migration recovery that can actually
// clear the poison. The hard reload routes through guardedReload so a
// deterministic crash-on-boot degrades into an observable, still-running
// fallback instead of an infinite reload loop (#1155).
const softRecoveries = ref(0)
const MAX_SOFT_RECOVERIES = 1

const canSoftRetry = computed(() => softRecoveries.value < MAX_SOFT_RECOVERIES)

// guardedReload allows one reload per session; a repeat is suppressed to break
// a boot loop. When that happens the Reload button would otherwise appear dead
// (no browser chrome in an installed PWA to fall back to), so surface a hint
// pointing to the one thing that DOES reset the session guard: relaunching.
const reloadSuppressed = ref(false)

onErrorCaptured((err) => {
  error.value = err
  logError(err, { source: 'ErrorBoundary', softRecoveries: softRecoveries.value })
  return false // prevent propagation
})

function tryAgain() {
  softRecoveries.value += 1
  error.value = null
}

function reload() {
  // guardedReload logs + returns false when suppressed (already reloaded once
  // this session). Reflect that in the UI so the button isn't a silent no-op —
  // relaunching the app is the recovery path once the guard has fired.
  reloadSuppressed.value = !guardedReload('error-boundary')
}
</script>
