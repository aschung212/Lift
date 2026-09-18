<template>
  <!-- Teleported like CalendarView's other overlays: the sheet is
       `position: fixed` and must escape `.tabContent`'s scroll container. -->
  <Teleport to="body">
    <div
      class="yrsheetOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="yrSheetTitle"
      @click.self="emit('close')"
    >
      <div class="yrsheetSheet" :style="{ paddingBottom: `max(env(safe-area-inset-bottom), 24px)` }">
        <div class="yrsheetHandle" aria-hidden="true"></div>

        <header class="yrsheetHeader">
          <div>
            <h2 id="yrSheetTitle" class="yrsheetTitle">{{ recap.year }} in Review</h2>
            <p class="yrsheetSub">{{ subtitle }}</p>
          </div>
          <button class="yrsheetClose" aria-label="Close year in review" @click="emit('close')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </header>

        <div class="yrsheetFormatToggle" role="group" aria-label="Card format">
          <button
            v-for="opt in FORMAT_OPTIONS"
            :key="opt.value"
            :aria-pressed="format === opt.value"
            :class="['yrsheetFormatBtn', { yrsheetFormatBtnActive: format === opt.value }]"
            @click="setFormat(opt.value)"
          >{{ opt.label }}</button>
        </div>

        <div class="yrsheetPreviewRow">
          <div class="yrsheetPreviewFrame" :class="{ yrsheetPreviewFrameStory: format === 'story' }">
            <div class="yrsheetPreviewInner" :class="{ yrsheetPreviewInnerStory: format === 'story' }">
              <component :is="previewComponent" :recap="recap" />
              <span v-if="showWatermark" class="yrsheetWatermark" aria-hidden="true">{{ WATERMARK_TEXT }}</span>
            </div>
          </div>
        </div>

        <footer class="yrsheetActions">
          <button class="yrsheetActionPrimary" :disabled="isSharing" @click="onShare">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>
            {{ isSharing ? 'Working…' : 'Share' }}
          </button>
          <button class="yrsheetActionSecondary" :disabled="isSharing" @click="onSave">
            Save image
          </button>
        </footer>

        <p v-if="lastResult" class="yrsheetStatus" role="status">{{ lastResult }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { YearRecap } from '../../lib/yearRecap'
import { WATERMARK_TEXT, type CardFormat } from '../../lib/shareImage'
import { cardComponent, loadCardComponent, recapCardFor } from './cardRegistry'
import { useWorkoutShare } from '../../composables/useWorkoutShare'
import { useTheme } from '../../composables/useTheme'
import { useModal } from '../../composables/useModal'
import { useSupporter } from '../../composables/useSupporter'
import { useAnalytics } from '../../composables/useAnalytics'

const props = defineProps<{ recap: YearRecap }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * This sheet is the top layer on the Calendar tab — nothing above it owns the
 * scroll lock or Escape (unlike `SharePickerSheet`, which nests under
 * WorkoutCompleteView / PRBurst), so it takes both itself via `useModal`.
 */
const { open: activateModal, close: deactivateModal } = useModal({
  selector: '.yrsheetOverlay',
  onEscape: () => emit('close'),
})
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

const format = ref<CardFormat>('square')
const activeCard = computed(() => recapCardFor(format.value))
const previewComponent = computed(() => cardComponent(activeCard.value.id))
const lastResult = ref<string | null>(null)

const subtitle = computed(() => {
  const days = `${props.recap.workouts} ${props.recap.workouts === 1 ? 'workout' : 'workouts'}`
  const sets = `${props.recap.sets} ${props.recap.sets === 1 ? 'set' : 'sets'}`
  return `${days} · ${sets}`
})

function setFormat(next: CardFormat) {
  if (next === format.value) return
  format.value = next
  logEvent('share_card_selected', { format: next, card: activeCard.value.id })
}

/** The filename stem — `lift-year-2026.png`. */
const filenameKey = computed(() => `year-${props.recap.year}`)

async function onShare() {
  lastResult.value = null
  const component = await loadCardComponent(activeCard.value.id)
  if (!component) return
  const res = await shareCard({
    component,
    format: format.value,
    props: { recap: props.recap },
    filenameKey: filenameKey.value,
    theme: currentTheme.value,
    mode: resolvedMode.value,
    watermark: showWatermark.value,
  })
  if (res.kind === 'downloaded') lastResult.value = `Saved ${res.filename}`
  else if (res.kind === 'shared') emit('close')
  else if (res.kind === 'error') lastResult.value = 'Share failed — try again'
}

async function onSave() {
  lastResult.value = null
  const component = await loadCardComponent(activeCard.value.id)
  if (!component) return
  const res = await downloadCard({
    component,
    format: format.value,
    props: { recap: props.recap },
    filenameKey: filenameKey.value,
    theme: currentTheme.value,
    mode: resolvedMode.value,
    watermark: showWatermark.value,
  })
  if (res.kind === 'downloaded') lastResult.value = `Saved ${res.filename}`
  else if (res.kind === 'error') lastResult.value = 'Save failed — try again'
}

onMounted(() => {
  activateModal()
  logEvent('share_opened', { format: format.value, card: activeCard.value.id })
})
onUnmounted(() => {
  deactivateModal()
})
</script>

<style scoped>
.yrsheetOverlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.yrsheetSheet {
  width: 100%;
  max-width: 520px;
  max-height: 92vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-secondary);
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  border-top: 1px solid var(--border-strong);
  padding: 8px 0 0;
  display: flex;
  flex-direction: column;
}

.yrsheetHandle {
  margin: 8px auto 16px;
  width: 36px;
  height: 4px;
  background: var(--border-strong);
  border-radius: 4px;
}

.yrsheetHeader {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 0 20px 4px;
}

.yrsheetTitle {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--font-title2);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.yrsheetSub {
  margin: 8px 0 0;
  font-family: var(--ff);
  font-weight: 500;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
}

.yrsheetClose {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.yrsheetFormatToggle {
  margin: 12px 20px 0;
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 4px;
}

.yrsheetFormatBtn {
  flex: 1;
  min-height: 44px;
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

.yrsheetFormatBtnActive {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
}

.yrsheetPreviewRow {
  padding: 16px 20px;
  display: flex;
  justify-content: center;
}

/* Cards are designed at 360x360 (square) / 360x640 (story) and scaled down for
   the preview — the same DOM the export pipeline rasterizes, so what you see is
   what shares. Mirrors SharePickerSheet's thumbnail treatment. */
.yrsheetPreviewFrame {
  position: relative;
  width: 260px;
  height: 260px;
  border-radius: 16px;
  overflow: hidden;
  border: 2px solid var(--accent);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6);
}

.yrsheetPreviewFrame.yrsheetPreviewFrameStory {
  width: 200px;
  height: 356px;
}

.yrsheetPreviewInner {
  position: absolute;
  top: 0;
  left: 0;
  width: 360px;
  height: 360px;
  transform: scale(0.7222);
  transform-origin: top left;
}

.yrsheetPreviewInner.yrsheetPreviewInnerStory {
  width: 360px;
  height: 640px;
  transform: scale(0.5556);
}

/* Mirrors createWatermarkElement() in shareImage.ts so the preview matches the
   exported PNG exactly. */
.yrsheetWatermark {
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

.yrsheetActions {
  padding: 0 20px;
  display: flex;
  gap: 12px;
}

.yrsheetActionPrimary,
.yrsheetActionSecondary {
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

.yrsheetActionPrimary {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
  font-weight: 700;
}

.yrsheetActionSecondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
}

.yrsheetActionPrimary:disabled,
.yrsheetActionSecondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.yrsheetStatus {
  margin: 12px 20px 0;
  font-family: var(--ff);
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  text-align: center;
}
</style>
