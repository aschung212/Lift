<template>
  <Teleport to="body">
    <div class="kbOverlay" @click.self="emit('close')">
      <div class="syncSheet" role="dialog" aria-modal="true" aria-labelledby="syncSheetTitle">
        <div class="syncSheetHead">
          <span class="syncSheetDot" :class="'syncSheetDot--' + status" aria-hidden="true"></span>
          <h3 id="syncSheetTitle" class="syncSheetTitle">{{ headline }}</h3>
        </div>

        <p class="syncSheetDetail">{{ detail }}</p>

        <dl class="syncSheetFacts">
          <div class="syncSheetFact">
            <dt class="syncSheetFactLabel">Waiting to sync</dt>
            <dd class="syncSheetFactValue">{{ unsentLabel }}</dd>
          </div>
          <div class="syncSheetFact">
            <dt class="syncSheetFactLabel">Last synced</dt>
            <dd class="syncSheetFactValue">{{ lastSyncedValue }}</dd>
          </div>
        </dl>

        <!--
          Always rendered, never v-if'd: the retry outcome lands right above the
          button the user just pressed, so appearing from nothing would shove
          that button down under their finger.
        -->
        <p class="syncSheetResult" role="status" aria-live="polite">{{ resultMessage }}</p>

        <button class="syncSheetRetry" :disabled="isRetrying" @click="retry">
          {{ isRetrying ? 'Trying…' : 'Try again now' }}
        </button>
        <button class="syncSheetClose" @click="emit('close')">Close</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * Plain-language sync status, and the one manual recovery the app offers
 * (LIFT-1323).
 *
 * Opened from the top-bar sync indicator, which until now was an icon-only
 * `<span>` explaining itself through a `:title` tooltip — invisible on touch.
 * Everything here answers a question the user could not previously ask: what
 * went wrong, how many of my changes are still unsent, how long has this been
 * true, and can I do anything about it.
 *
 * The reassurance in `detail` is load-bearing, not padding. The app is
 * local-first, so a sync failure never loses data — but "Sync failed" alone
 * reads like it did, and a lifter mid-session needs to know their sets are
 * safe before they need to know why the server is unhappy.
 */
import { computed, onMounted } from 'vue'
import { useModal } from '../composables/useModal'
import { useSyncStatus } from '../composables/useSyncStatus'

const emit = defineEmits<{ (e: 'close'): void }>()

const {
  status,
  headline,
  detail,
  unsentChanges,
  lastSyncedLabel,
  isRetrying,
  lastRetryResult,
  syncNow,
  refreshAge,
} = useSyncStatus()

// The component's existence IS "open" (App.vue renders it behind a v-if), so
// the lifecycle is driven from mount rather than from a model prop. useModal
// owns the scroll lock, the focus trap and Escape; its own onUnmounted releases
// all three, so there is nothing to undo here.
const modal = useModal({ selector: '.syncSheet', onEscape: () => emit('close') })
onMounted(() => {
  // Measure "last synced" against the moment the sheet opened, not against a
  // ticking clock — the age is coarse and this surface is short-lived.
  refreshAge()
  modal.open()
})

const unsentLabel = computed(() =>
  unsentChanges.value === 0
    ? 'Nothing'
    : `${unsentChanges.value} change${unsentChanges.value === 1 ? '' : 's'}`,
)

// "Up to date" rather than an age while everything agrees: the stamp only moves
// when the status transitions, so a healthy app idle since breakfast would
// otherwise report "6 hours ago" and read as broken.
const lastSyncedValue = computed(() => {
  if (status.value === 'synced') return 'Up to date'
  return lastSyncedLabel.value ?? 'Not yet'
})

const resultMessage = computed(() => {
  switch (lastRetryResult.value) {
    case 'synced': return 'All changes synced.'
    case 'offline': return 'Still offline — Logbook will retry as soon as you reconnect.'
    case 'failed': return 'Still could not sync. Your changes are safe on this device.'
    default: return ''
  }
})

async function retry() {
  await syncNow()
}
</script>
