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
import { ref, computed, nextTick, onErrorCaptured } from 'vue'
import { logError } from '../lib/logger'
import { guardedReload } from '../lib/reloadGuard'

const error = ref<Error | null>(null)

// A soft "Try again" merely clears the error flag and re-renders the same
// subtree. That only helps a genuinely transient error; a deterministic one
// (a corrupt persisted value poisoning a render, a bad theme id) re-throws
// SYNCHRONOUSLY during the re-render, and clearing the flag again would trap
// the user in a fallback↔crash flicker with no way out. So we detect that
// re-throw (`retrying` is true only while the re-render triggered by tryAgain
// is in flight) and, once a soft recovery has demonstrably failed, offer only
// the hard reload — which re-runs the boot-time IDB-restore / migration
// recovery that can actually clear the poison. The hard reload routes through
// guardedReload so a deterministic crash-on-boot degrades into an observable,
// still-running fallback instead of an infinite reload loop (#1155). Counting
// only *failed* retries (not every tap) means a successful transient recovery
// leaves the soft path available for the next, unrelated error.
const softRecoveryFailed = ref(false)
let retrying = false

const canSoftRetry = computed(() => !softRecoveryFailed.value)

// guardedReload allows one reload per session; a repeat is suppressed to break
// a boot loop. When that happens the Reload button would otherwise appear dead
// (no browser chrome in an installed PWA to fall back to), so surface a hint
// pointing to the one thing that DOES reset the session guard: relaunching.
const reloadSuppressed = ref(false)

onErrorCaptured((err) => {
  // A fresh error (not the synchronous re-throw of a failed soft retry) is a
  // clean slate: restore the soft path and clear any stale suppression hint
  // so the two recovery affordances reflect THIS error, not a prior one.
  if (!retrying) {
    softRecoveryFailed.value = false
    reloadSuppressed.value = false
  }
  error.value = err
  logError(err, { source: 'ErrorBoundary', softRecoveryFailed: softRecoveryFailed.value })
  return false // prevent propagation
})

async function tryAgain() {
  error.value = null
  retrying = true
  await nextTick()
  retrying = false
  // If the same subtree re-threw during the re-render, onErrorCaptured set
  // error again — the soft path is futile, so fall back to hard reload only.
  if (error.value) {
    softRecoveryFailed.value = true
  }
}

function reload() {
  // guardedReload logs + returns false when suppressed (already reloaded once
  // this session). Reflect that in the UI so the button isn't a silent no-op —
  // relaunching the app is the recovery path once the guard has fired.
  reloadSuppressed.value = !guardedReload('error-boundary')
}
</script>
