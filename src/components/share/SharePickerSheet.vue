<template>
  <div
    class="spOverlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="spTitle"
    @click.self="emit('close')"
  >
    <div class="spSheet" :style="{ paddingBottom: `max(env(safe-area-inset-bottom), 24px)` }">
      <div class="spHandle" aria-hidden="true"></div>

      <header class="spHeader">
        <div class="spTitleBlock">
          <h2 id="spTitle" class="spTitle">Pick a card</h2>
          <p class="spSub">Same data, different vibe</p>
        </div>
        <span class="spCount">{{ activeIndex + 1 }} / {{ cards.length }}</span>
      </header>

      <div class="spFormatToggle" role="tablist">
        <button
          v-for="opt in FORMAT_OPTIONS"
          :key="opt.value"
          role="tab"
          :aria-selected="format === opt.value"
          :class="['spFormatBtn', { spFormatBtnActive: format === opt.value }]"
          @click="setFormat(opt.value)"
        >{{ opt.label }}</button>
      </div>

      <div class="spThumbRow" :class="{ spThumbRowStory: format === 'story' }">
        <button
          v-for="(card, i) in cards"
          :key="card.id"
          :class="['spThumb', { spThumbActive: i === activeIndex }]"
          :aria-pressed="i === activeIndex"
          :aria-label="`Select ${card.label} card`"
          @click="selectCard(i)"
        >
          <div class="spThumbCard" :class="{ spThumbCardStory: format === 'story' }">
            <div class="spThumbInner" :class="{ spThumbInnerStory: format === 'story' }">
              <component :is="cardComponent(card.id)" :summary="summary" />
              <span v-if="showWatermark" class="spWatermark" aria-hidden="true">{{ WATERMARK_TEXT }}</span>
            </div>
          </div>
          <span class="spThumbLabel">{{ card.label }}</span>
        </button>
      </div>

      <footer class="spActions">
        <button
          class="spActionPrimary"
          :disabled="isSharing || !activeCard"
          @click="onShare"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>
          {{ isSharing ? 'Working…' : 'Share' }}
        </button>
        <button
          class="spActionSecondary"
          :disabled="isSharing || !activeCard"
          @click="onSave"
        >
          Save image
        </button>
      </footer>

      <p v-if="lastResult" class="spStatus" role="status">{{ lastResult }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SessionSummary } from '../../lib/sessionSummary'
import { WATERMARK_TEXT, type CardFormat } from '../../lib/shareImage'
import { cardComponent, eligibleSquareCards, eligibleStoryCards, loadCardComponent, resolveInitialCard } from './cardRegistry'
import { useWorkoutShare } from '../../composables/useWorkoutShare'
import { useTheme } from '../../composables/useTheme'
import { useModal } from '../../composables/useModal'
import { useSupporter } from '../../composables/useSupporter'
import { useAnalytics } from '../../composables/useAnalytics'

const props = defineProps<{
  summary: SessionSummary
  /**
   * Pre-select a specific card by id when opening (e.g. 'pr-focus' from the
   * "Share this PR" peak-moment entry point, #716). Falls back to the default
   * first card when the id is unknown or not eligible for this summary.
   */
  initialCardId?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

// lockScroll:false — the parent (WorkoutCompleteView / PRBurst) already owns
// the background-scroll lock for this surface. See the onMounted note below.
const { open: activateTrap, close: deactivateTrap } = useModal({ selector: '.spOverlay', lockScroll: false })
const { currentTheme, resolvedMode } = useTheme()
const { shareCard, downloadCard, isSharing } = useWorkoutShare()
const { isSupporter } = useSupporter()
const { logEvent } = useAnalytics()

// Free tier gets the "Made with Lift" watermark; supporters get clean cards.
const showWatermark = computed(() => !isSupporter.value)

const FORMAT_OPTIONS: { value: CardFormat; label: string }[] = [
  { value: 'square', label: 'Post' },
  { value: 'story', label: 'Story' },
]

// Resolve the optional pre-selected card up front so both the format toggle
// and the active thumbnail open on it. `cards` is derived from `format`, so
// initializing `format` correctly means the cards list is right from the
// first render and the watch(cards) reset below never fires on mount.
const initialSelection = props.initialCardId
  ? resolveInitialCard(props.summary, props.initialCardId)
  : null
const format = ref<CardFormat>(initialSelection?.format ?? 'square')

const cards = computed(() =>
  format.value === 'square'
    ? eligibleSquareCards(props.summary)
    : eligibleStoryCards(props.summary)
)
const activeIndex = ref(initialSelection?.index ?? 0)
const activeCard = computed(() => cards.value[activeIndex.value] ?? null)
const lastResult = ref<string | null>(null)

function setFormat(next: CardFormat) {
  if (next === format.value) return
  format.value = next
  logEvent('share_card_selected', { format: next, card: cards.value[0]?.id ?? null })
}

function selectCard(i: number) {
  if (i === activeIndex.value) return
  activeIndex.value = i
  logEvent('share_card_selected', { format: format.value, card: cards.value[i]?.id ?? null })
}

// Reset selection when the card list changes (e.g. format toggle).
watch(cards, () => { activeIndex.value = 0 })

async function onShare() {
  const card = activeCard.value
  if (!card) return
  lastResult.value = null
  const component = await loadCardComponent(card.id)
  if (!component) return
  const res = await shareCard({
    component,
    format: card.format,
    summary: props.summary,
    theme: currentTheme.value,
    mode: resolvedMode.value,
    watermark: showWatermark.value,
  })
  if (res.kind === 'downloaded') lastResult.value = `Saved ${res.filename}`
  else if (res.kind === 'shared') emit('close')
  else if (res.kind === 'error') lastResult.value = 'Share failed — try again'
}

async function onSave() {
  const card = activeCard.value
  if (!card) return
  lastResult.value = null
  const component = await loadCardComponent(card.id)
  if (!component) return
  const res = await downloadCard({
    component,
    format: card.format,
    summary: props.summary,
    theme: currentTheme.value,
    mode: resolvedMode.value,
    watermark: showWatermark.value,
  })
  if (res.kind === 'downloaded') lastResult.value = `Saved ${res.filename}`
  else if (res.kind === 'error') lastResult.value = 'Save failed — try again'
}

// Escape is owned by the parent (WorkoutCompleteView) — its single
// listener routes Escape to either close-picker or close-view based on
// whether the picker is open. Two listeners on window racing each other
// to handle the same key is fragile with stopImmediatePropagation; one
// owner is simpler and avoids closing the underlying summary by accident.
//
// `modal-open` is owned by the parent (useModal lockScroll:false above).
// If the picker locked too, closing it would drop the parent's count/boolean
// and re-enable background scroll while the parent is still up.
onMounted(() => {
  activateTrap()
  logEvent('share_opened', { format: format.value })
})
onUnmounted(() => {
  deactivateTrap()
})
</script>

<style scoped>
.spOverlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.spSheet {
  width: 100%;
  max-width: 520px;
  background: var(--bg-secondary);
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  border-top: 1px solid var(--border-strong);
  padding: 8px 0 0;
  display: flex;
  flex-direction: column;
}

.spHandle {
  margin: 8px auto 16px;
  width: 36px;
  height: 4px;
  background: var(--border-strong);
  border-radius: 4px;
}

.spHeader {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 20px 4px;
}

.spTitle {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--font-title2);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.spSub {
  margin: 8px 0 0;
  font-family: var(--ff);
  font-weight: 500;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
}

.spCount {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.spFormatToggle {
  margin: 12px 20px 0;
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px;
}

.spFormatBtn {
  flex: 1;
  min-height: 36px;
  background: transparent;
  border: 0;
  border-radius: 8px;
  font-family: var(--ff);
  font-weight: 600;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.spFormatBtnActive {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
}

.spThumbRow {
  margin-top: 12px;
  padding: 8px 16px 16px;
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.spThumb {
  flex: 0 0 auto;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  min-height: 44px;
}

.spThumbCard {
  position: relative;
  width: 220px;
  height: 220px;
  border-radius: 16px;
  overflow: hidden;
  border: 2px solid transparent;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6);
  transition: border-color 120ms ease;
}

/* Story format thumbnails are taller (9:16). Width matches the square row
   for a consistent scroll rhythm; height grows. */
.spThumbCard.spThumbCardStory {
  width: 180px;
  height: 320px;
}

.spThumbActive .spThumbCard {
  border-color: var(--accent);
}

/* Cards are designed at 360x360 (square) or 360x640 (story) — render at full
   size and scale down for the thumbnail. Same DOM the export pipeline uses,
   so what you see is what shares. */
.spThumbInner {
  position: absolute;
  top: 0;
  left: 0;
  width: 360px;
  height: 360px;
  transform: scale(0.6111);
  transform-origin: top left;
}

.spThumbInner.spThumbInnerStory {
  width: 360px;
  height: 640px;
  transform: scale(0.5);
}

/* Mirrors createWatermarkElement() in shareImage.ts so the preview matches
   the exported PNG exactly. Lives inside .spThumbInner (the 360px card
   surface) so it scales down with the thumbnail. */
.spWatermark {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 10;
  pointer-events: none;
  font-family: var(--ff-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.spThumbLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.spThumbActive .spThumbLabel {
  color: var(--accent);
}

.spActions {
  padding: 8px 20px 0;
  display: flex;
  gap: 12px;
}

.spActionPrimary,
.spActionSecondary {
  flex: 1;
  min-height: 48px;
  border-radius: 12px;
  font-family: var(--ff);
  font-weight: 600;
  font-size: var(--font-callout);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.spActionPrimary {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
  font-weight: 700;
}

.spActionSecondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
}

.spActionPrimary:disabled,
.spActionSecondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.spStatus {
  margin: 12px 20px 0;
  font-family: var(--ff);
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  text-align: center;
}
</style>
