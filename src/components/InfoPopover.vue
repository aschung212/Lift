<template>
  <!-- Subtle inline info affordance (LIFT-1143). Renders only a small circled-i
       glyph; the sanctioned 44pt hit area is extended via a transparent
       ::before overlay (same pattern as .logSetFieldClear) so the tiny visual
       icon never inflates the line height of the caption it sits in. The
       explanation bubble is Teleported to <body> so a modal's `overflow:hidden`
       can never clip it, and anchored to the trigger via getBoundingClientRect. -->
  <button
    ref="triggerEl"
    type="button"
    class="infoPopover"
    :aria-label="`What is ${label}? ${open ? 'Hide' : 'Show'} explanation`"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click.stop="toggle"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="open" class="infoPopoverBackdrop" @click="close">
      <div
        ref="bubbleEl"
        class="infoPopoverBubble"
        role="dialog"
        :aria-label="title"
        :style="bubbleStyle"
        tabindex="-1"
        @click.stop
      >
        <p class="infoPopoverTitle">{{ title }}</p>
        <p class="infoPopoverBody"><slot></slot></p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, nextTick, onBeforeUnmount } from 'vue'

defineProps<{
  /** The term being explained — used only for the trigger's aria-label. */
  label: string
  /** Heading shown at the top of the popover bubble. */
  title: string
}>()

const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)
const bubbleEl = ref<HTMLElement | null>(null)
const bubbleStyle = ref<Record<string, string>>({})

const BUBBLE_WIDTH = 244
const MARGIN = 12
const GAP = 8

/* Dismiss listeners are declared passive (LIFT-1238): `close` never calls
   preventDefault, and a non-passive capture-phase scroll listener forces the
   compositor to wait on the main thread for every scroll frame while a popover
   is open — measurable jank on the iOS-first target. Options are shared
   constants so the add/remove pairs can never drift out of sync. Removal
   matches on the capture flag alone, so it is spelled explicitly on both:
   `true` for scroll (the anchor may live inside a scrolling container, whose
   scroll events do not bubble to window) and `false` for resize. */
const SCROLL_OPTS = { passive: true, capture: true } as const
const RESIZE_OPTS = { passive: true, capture: false } as const

/** Anchor the fixed-position bubble under the trigger, clamped to the viewport
 *  so it can never overflow off-screen on a narrow phone. */
function positionBubble(): void {
  const el = triggerEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const centerX = r.left + r.width / 2
  const left = Math.max(MARGIN, Math.min(centerX - BUBBLE_WIDTH / 2, vw - MARGIN - BUBBLE_WIDTH))
  bubbleStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(r.bottom + GAP)}px`,
    width: `${BUBBLE_WIDTH}px`,
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
  }
}

async function toggle(): Promise<void> {
  if (open.value) {
    close()
    return
  }
  open.value = true
  window.addEventListener('keydown', onKeydown, true)
  // iOS-native popovers dismiss on scroll rather than drifting with the anchor.
  window.addEventListener('scroll', close, SCROLL_OPTS)
  window.addEventListener('resize', close, RESIZE_OPTS)
  await nextTick()
  positionBubble()
  bubbleEl.value?.focus()
}

function close(): void {
  if (!open.value) return
  open.value = false
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('scroll', close, SCROLL_OPTS)
  window.removeEventListener('resize', close, RESIZE_OPTS)
  // Return focus to the trigger so keyboard users aren't stranded.
  triggerEl.value?.focus()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('scroll', close, SCROLL_OPTS)
  window.removeEventListener('resize', close, RESIZE_OPTS)
})
</script>

<style scoped>
.infoPopover {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  margin-left: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  line-height: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Extend the hit area to 44x44pt without inflating the caption's line height.
   Safe here because the icon is a lone control ringed by inert text, not a
   tiling control (see CLAUDE.md iOS Compliance note). */
.infoPopover::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
}

.infoPopoverBackdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
}

.infoPopoverBubble {
  position: fixed;
  max-width: calc(100vw - 24px);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 12px 16px;
  outline: none;
}

.infoPopoverTitle {
  margin: 0 0 4px;
  font: 600 var(--font-footnote) / 1.3 var(--ff);
  color: var(--text-primary);
}

.infoPopoverBody {
  margin: 0;
  font: 400 var(--font-footnote) / 1.4 var(--ff);
  color: var(--text-secondary);
}
</style>
