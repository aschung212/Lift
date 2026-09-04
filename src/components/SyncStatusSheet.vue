<template>
  <Teleport to="body">
    <div class="kbOverlay" @click.self="emit('close')">
      <div class="syncSheet" role="dialog" aria-modal="true" aria-labelledby="sync-sheet-title">
        <h3 id="sync-sheet-title" class="kbTitle syncSheetTitle">{{ copy.title }}</h3>
        <!-- Live so the outcome of "Sync now" reaches a screen reader: the
             global sync live region in App.vue only speaks on a TRANSITION, and
             a retry that fails the same way twice never changes it. -->
        <p class="syncSheetDetail" role="status" aria-live="polite">{{ copy.detail }}</p>

        <dl v-if="!localOnly" class="syncSheetFacts">
          <div class="syncSheetRow">
            <dt class="syncSheetLabel">Last synced</dt>
            <dd class="syncSheetValue">{{ lastSyncedLabel }}</dd>
          </div>
          <div class="syncSheetRow">
            <dt class="syncSheetLabel">Waiting to sync</dt>
            <dd class="syncSheetValue">{{ pendingLabel }}</dd>
          </div>
        </dl>

        <div class="syncSheetActions">
          <button
            v-if="!localOnly"
            class="syncSheetBtn syncSheetSync"
            :disabled="syncDisabled"
            @click="emit('sync-now')"
          >
            {{ busy ? 'Syncing…' : 'Sync now' }}
          </button>
          <button class="syncSheetBtn syncSheetClose" @click="emit('close')">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * What the sync indicator means, and the one thing the user can do about it
 * (LIFT-1323).
 *
 * Before this, the whole explanation lived in a `:title` tooltip on a 24px icon
 * — hover-only, on an app whose own guidelines ban hover-gated affordances for
 * the iOS target — so on a phone the failure state was literally unreadable and
 * there was no manual retry anywhere in the app.
 *
 * Presentational and prop-driven (`src/components/` convention): App.vue owns
 * the state, this owns the wording and the layout. All copy comes from the pure
 * `syncStatusCopy` helpers so the phrasing is testable without a mount.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useModal } from '../composables/useModal'
import type { SyncStatus } from '../lib/syncStatus'
import { changeCount, describeSyncState, formatLastSynced } from '../lib/syncStatusCopy'

const props = defineProps<{
  /** Folded indicator status (write queue + read errors + stranded writes). */
  status: SyncStatus
  /** Changes the server does not have yet. */
  pendingCount: number
  /** Of those, the ones this session has stopped retrying on its own. */
  strandedCount: number
  /** Wall-clock ms of the last confirmed server exchange, or null. */
  lastSyncedAt: number | null
  /** No account to sync to — a guest, or a preview deploy. */
  localOnly: boolean
  /** A user-initiated sync is in flight. */
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'sync-now'): void
}>()

// Background-scroll lock, focus trap and the single Escape listener, all owned
// by useModal (the settled pattern — never hand-roll these). The parent renders
// this component behind a `v-if`, so the modal opens on mount.
const { open: activateTrap, close: deactivateTrap } = useModal({
  selector: '.syncSheet',
  onEscape: () => emit('close'),
})
onMounted(activateTrap)
onUnmounted(deactivateTrap)

const copy = computed(() => describeSyncState({
  status: props.status,
  pending: props.pendingCount,
  stranded: props.strandedCount,
  localOnly: props.localOnly,
}))

// Sampled rather than ticked: the sheet is a glance, not a dashboard, so a
// running timer would burn wakeups to re-render "3 minutes ago" for nobody.
// Re-sampled when a sync settles, which is the only moment the answer changes
// while the sheet is open.
const nowMs = ref(Date.now())
watch(() => [props.lastSyncedAt, props.busy], () => { nowMs.value = Date.now() })

const lastSyncedLabel = computed(() => formatLastSynced(props.lastSyncedAt, nowMs.value))
const pendingLabel = computed(() =>
  props.pendingCount === 0 ? 'Nothing' : changeCount(props.pendingCount),
)

// Offline is answered without a round trip (every request would fail and the
// writes are already durable); 'syncing' means one is already running.
const syncDisabled = computed(
  () => props.busy || props.status === 'offline' || props.status === 'syncing',
)
</script>
