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

      <div class="wcBody">
        <div class="wcBodyInner">
          <template v-if="hasSets">
            <section class="wcHero">
              <div class="wcMicrolabel">Total volume</div>
              <div class="wcHeroNumber">{{ formattedVolume }}</div>
              <div class="wcHeroUnit">{{ summary.unitLabel }} moved</div>
            </section>

            <section class="wcStatRow">
              <div v-if="hasDuration" class="wcStat">
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
              <div class="wcBestSetE1RM">~{{ summary.bestSet.e1RM }} {{ summary.unitLabel }} e1RM<InfoPopover
                label="e1RM"
                title="Estimated 1-rep max"
              >Your predicted max for a single all-out rep, calculated from the weight and reps you lifted.</InfoPopover></div>
            </section>

            <section v-if="showBreakdown" class="wcBreakdown">
              <h2 class="wcBreakdownLabel">
                {{ summary.highlights.length }} {{ summary.highlights.length === 1 ? 'exercise' : 'exercises' }}
              </h2>
              <ul class="wcBreakdownList">
                <li v-for="h in summary.highlights" :key="h.exerciseId" class="wcBreakdownRow">
                  <div class="wcBreakdownMain">
                    <span class="wcBreakdownName">{{ h.name }}</span>
                    <span v-if="h.badge" class="wcBreakdownBadge">{{ h.badge.toUpperCase() }}</span>
                  </div>
                  <div class="wcBreakdownMeta">
                    <span class="wcBreakdownTop">{{ h.weight }} × {{ h.reps }}</span>
                    <span class="wcBreakdownVolume">{{ formatVolume(h.volume) }} {{ summary.unitLabel }}</span>
                  </div>
                </li>
              </ul>
            </section>
          </template>

          <section v-else class="wcEmpty">
            <div class="wcEmptyTitle">No sets logged yet</div>
            <div class="wcEmptyBody">Log a set first, then come back here to see your summary.</div>
          </section>
        </div>
      </div>

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
import InfoPopover from './InfoPopover.vue'
import type { SessionSummary } from '../lib/sessionSummary'

const SharePickerSheet = defineAsyncComponent(() => import('./share/SharePickerSheet.vue'))

const props = defineProps<{ summary: SessionSummary }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pickerOpen = ref(false)
function openPicker() {
  pickerOpen.value = true
}

// Background-scroll lock, focus trap, and the single Escape listener are all
// owned by useModal now. onEscape closes the topmost open layer: the nested
// share sheet if it's up (SharePickerSheet delegates its Escape to this
// parent), otherwise the summary view itself.
const { open: activateTrap, close: deactivateTrap } = useModal({
  selector: '.wcOverlay',
  onEscape: () => {
    if (pickerOpen.value) {
      pickerOpen.value = false
      return
    }
    emit('close')
  },
})

const summary = computed(() => props.summary)

const hasSets = computed(() => summary.value.setsCompleted > 0)
const formattedVolume = computed(() => summary.value.totalVolume.toLocaleString('en-US'))

/**
 * `sessionSummary` reports an em dash when the session span is unknowable. Since
 * #1288 that is the genuine edge case it was always meant to be — a session made
 * entirely of pre-#846 sets, or one back-dated in a single sitting — rather than
 * every session for every user. Rendering an empty TIME tile reads as a broken
 * stat, so the tile is dropped in that case and the row redistributes.
 */
const hasDuration = computed(() => summary.value.duration !== '\u2014')

function formatVolume(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}

/**
 * The per-exercise ledger only earns its place once there is more than one
 * exercise. On a single-exercise day the best-set card already IS the whole
 * session, and a one-row list under it just restates the same numbers.
 */
const showBreakdown = computed(() => summary.value.highlights.length > 1)

onMounted(() => {
  activateTrap()
})
onUnmounted(() => {
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
  min-width: 0;
  padding: max(env(safe-area-inset-top), 16px) 20px max(env(safe-area-inset-bottom), 24px);
  display: flex;
  flex-direction: column;
  isolation: isolate;
}

/*
 * The summary is short on a light day and long on a heavy one, so the body
 * scrolls between a pinned header and a pinned footer. `margin-block: auto` on
 * the inner stack optically centres a short session instead of stranding it at
 * the top with a screen of dead space underneath, and collapses to no-op the
 * moment the content is taller than the viewport (so nothing is ever clipped
 * out of reach the way `justify-content: center` would clip it).
 */
.wcBody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  /* Fades whatever sits against the bottom edge, so a session too long for the
     screen reads as "there's more" instead of a row sliced off by the footer.
     Invisible when the content fits, because centring leaves slack there. */
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent 100%);
}

.wcBodyInner {
  margin-block: auto;
  width: 100%;
  /* Matches the fade length below, so at the end of the scroll the last row
     sits above the fade rather than under it. */
  padding-bottom: 24px;
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
  padding: 24px 0 0;
}

.wcMicrolabel {
  font: 500 var(--font-caption2) / 1 var(--ff-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wcHeroNumber {
  margin-top: 12px;
  /* Scales with the viewport so a six-figure volume can't run to the bezels
     on a 375pt screen the way a fixed 88px did. */
  font: 800 clamp(52px, 17vw, 72px) / 1 var(--ff-display);
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wcHeroUnit {
  margin-top: 8px;
  font: 600 var(--font-subhead) / 1 var(--ff);
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.wcStatRow {
  display: grid;
  /* Auto columns rather than a fixed 3-up: the TIME tile is dropped when the
     session span is unknowable, and the remaining tiles fill the row. */
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 8px;
  margin-top: 24px;
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
  margin-top: 16px;
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

/*
 * The per-exercise record. `summary.highlights` is already computed (and
 * already rendered on the receipt share card) — the screen just wasn't showing
 * it, which is what left a screen-height of blank between the best set and the
 * buttons. Volume-descending order comes straight from sessionSummary.
 */
.wcBreakdown {
  margin-top: 24px;
}

.wcBreakdownLabel {
  margin: 0 0 8px;
  padding: 0 4px;
  font: 500 var(--font-caption2) / 1 var(--ff-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wcBreakdownList {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
}

.wcBreakdownRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
}

.wcBreakdownRow + .wcBreakdownRow {
  border-top: 1px solid var(--border);
}

.wcBreakdownMain {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wcBreakdownName {
  font: 600 var(--font-subhead) / 1.2 var(--ff);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wcBreakdownBadge {
  flex: none;
  font: 700 9px / 1 var(--ff-mono);
  letter-spacing: 0.1em;
  color: var(--accent);
  background: var(--accent-subtle);
  padding: 4px 8px;
  border-radius: 6px;
}

.wcBreakdownMeta {
  flex: none;
  text-align: right;
}

.wcBreakdownTop {
  display: block;
  font: 600 var(--font-subhead) / 1.2 var(--ff-display);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wcBreakdownVolume {
  display: block;
  margin-top: 2px;
  font: 500 var(--font-caption2) / 1 var(--ff);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.wcEmpty {
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
  flex: none;
  padding-top: 16px;
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
