<template>
  <div
    class="wcOverlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="wcTitle"
    @click.self="emit('close')"
  >
    <div class="wcSurface">
      <div class="wcMesh" aria-hidden="true"></div>

      <header class="wcHeader">
        <button class="wcLink" @click="emit('close')" aria-label="Close summary">Close</button>
        <span id="wcTitle" class="wcEyebrow">Workout complete</span>
        <span class="wcLinkSpacer" aria-hidden="true"></span>
      </header>

      <template v-if="hasSets">
        <section class="wcHero">
          <div class="wcMicrolabel">Total volume</div>
          <div class="wcHeroNumber">{{ formattedVolume }}</div>
          <div class="wcHeroUnit">{{ summary.unitLabel }} moved</div>
        </section>

        <section class="wcStatRow">
          <div class="wcStat">
            <div class="wcStatKey">TIME</div>
            <div class="wcStatVal">{{ summary.duration }}</div>
          </div>
          <div class="wcStat">
            <div class="wcStatKey">SETS</div>
            <div class="wcStatVal">{{ summary.setsCompleted }}</div>
          </div>
          <div class="wcStat wcStatAccent">
            <div class="wcStatKey">PRs</div>
            <div class="wcStatVal">{{ summary.prs + summary.repPRs }}</div>
          </div>
        </section>

        <section v-if="summary.bestSet" class="wcBestSet">
          <div class="wcBestSetHead">
            <span class="wcBestSetEyebrow"><span aria-hidden="true">🏆</span> Best set</span>
            <span v-if="summary.bestSet.isPR" class="wcBestSetBadge">NEW PR</span>
          </div>
          <div class="wcBestSetName">{{ summary.bestSet.name }}</div>
          <div class="wcBestSetWeight">{{ summary.bestSet.weight }} × {{ summary.bestSet.reps }}</div>
          <div class="wcBestSetE1RM">~{{ summary.bestSet.e1RM }} {{ summary.unitLabel }} e1RM</div>
        </section>
      </template>

      <section v-else class="wcEmpty">
        <div class="wcEmptyTitle">No sets logged yet</div>
        <div class="wcEmptyBody">Log a set first, then come back here to see your summary.</div>
      </section>

      <footer class="wcFooter">
        <button v-if="hasSets" class="wcShare" @click="openPicker">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>
          Share summary
        </button>
        <button class="wcDone" :class="{ wcDoneSecondary: hasSets }" @click="emit('close')">Done</button>
      </footer>
    </div>

    <SharePickerSheet
      v-if="pickerOpen"
      :summary="summary"
      @close="pickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, defineAsyncComponent } from 'vue'
import { useModal } from '../composables/useModal'
import type { SessionSummary } from '../lib/sessionSummary'

const SharePickerSheet = defineAsyncComponent(() => import('./share/SharePickerSheet.vue'))

const props = defineProps<{ summary: SessionSummary }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pickerOpen = ref(false)
function openPicker() {
  pickerOpen.value = true
}

const { open: activateTrap, close: deactivateTrap } = useModal({ selector: '.wcOverlay' })

const summary = computed(() => props.summary)

const hasSets = computed(() => summary.value.setsCompleted > 0)
const formattedVolume = computed(() => summary.value.totalVolume.toLocaleString('en-US'))

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // Single Escape owner for both layers — close the topmost open thing.
  if (pickerOpen.value) {
    pickerOpen.value = false
    return
  }
  emit('close')
}
onMounted(async () => {
  // Background-scroll lock is owned by useModal (activateTrap) now.
  window.addEventListener('keydown', onKey)
  activateTrap()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  deactivateTrap()
})
</script>

<style scoped>
.wcOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-primary);
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.wcSurface {
  position: relative;
  width: 100%;
  max-width: 520px;
  padding: max(env(safe-area-inset-top), 16px) 20px max(env(safe-area-inset-bottom), 24px);
  display: flex;
  flex-direction: column;
  isolation: isolate;
}

.wcMesh {
  position: absolute;
  inset: 0;
  background-image: var(--mesh);
  pointer-events: none;
  z-index: -1;
}

.wcHeader {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 8px 0 4px;
  min-height: 44px;
}

.wcLink {
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  font: 500 var(--font-callout) / 1 var(--ff);
  padding: 12px 0;
  text-align: left;
  cursor: pointer;
  min-height: 44px;
  min-width: 44px;
}

.wcLinkSpacer {
  display: block;
  width: 44px;
}

.wcEyebrow {
  font: 600 var(--font-caption2) / 1 var(--ff-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: center;
}

.wcHero {
  text-align: center;
  padding: 32px 0 8px;
}

.wcMicrolabel {
  font: 500 var(--font-caption2) / 1 var(--ff-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wcHeroNumber {
  margin-top: 16px;
  font: 800 88px / 1 var(--ff-display);
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wcHeroUnit {
  margin-top: 4px;
  font: 600 var(--font-subhead) / 1 var(--ff);
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.wcStatRow {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-top: 32px;
}

.wcStat {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 8px;
  text-align: center;
}

.wcStatAccent {
  border-color: var(--accent);
}

.wcStatKey {
  font: 500 10px / 1 var(--ff-mono);
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.wcStatVal {
  margin-top: 8px;
  font: 700 var(--font-title2) / 1 var(--ff-display);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wcStatAccent .wcStatVal {
  color: var(--accent);
}

.wcBestSet {
  margin-top: 24px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  padding: 16px;
}

.wcBestSetHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.wcBestSetEyebrow {
  font: 500 10px / 1 var(--ff-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.wcBestSetBadge {
  font: 700 10px / 1 var(--ff-mono);
  color: var(--accent);
  background: var(--accent-subtle);
  padding: 4px 8px;
  border-radius: 6px;
  letter-spacing: 0.1em;
}

.wcBestSetName {
  margin-top: 12px;
  font: 700 19px / 1.15 var(--ff-display);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.wcBestSetWeight {
  margin-top: 8px;
  font: 600 26px / 1 var(--ff-display);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.wcBestSetE1RM {
  margin-top: 4px;
  font: 500 var(--font-caption1) / 1 var(--ff);
  color: var(--text-secondary);
}

.wcEmpty {
  margin: auto 0;
  text-align: center;
  padding: 0 24px;
}

.wcEmptyTitle {
  font: 700 var(--font-title2) / 1.2 var(--ff-display);
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.wcEmptyBody {
  margin-top: 8px;
  font: 500 var(--font-callout) / 1.4 var(--ff);
  color: var(--text-secondary);
}

.wcFooter {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wcShare {
  width: 100%;
  min-height: 54px;
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
  border-radius: 16px;
  font: 700 var(--font-callout) / 1 var(--ff);
  letter-spacing: 0.01em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.wcDone {
  width: 100%;
  min-height: 54px;
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
  border-radius: 16px;
  font: 700 var(--font-callout) / 1 var(--ff);
  letter-spacing: 0.01em;
  cursor: pointer;
}

.wcDoneSecondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
  font-weight: 600;
  min-height: 48px;
}
</style>
