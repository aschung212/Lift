<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :width="size"
    :height="size"
    :stroke-width="resolvedStrokeWidth"
    :stroke-linecap="def.rounded ? 'round' : undefined"
    :stroke-linejoin="def.rounded ? 'round' : undefined"
  >
    <template v-for="(shape, i) in def.shapes" :key="i">
      <path v-if="shape[0] === 'path'" v-bind="shape[1]" />
      <circle v-else-if="shape[0] === 'circle'" v-bind="shape[1]" />
      <line v-else-if="shape[0] === 'line'" v-bind="shape[1]" />
      <polyline v-else-if="shape[0] === 'polyline'" v-bind="shape[1]" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from '../lib/icons'

// Shared stroke-icon renderer (#1116). Reproduces the canonical 24×24 wrapper
// (viewBox, fill=none, stroke=currentColor) for a registry glyph so each icon's
// path data is authored once. class / aria-* / role fall through onto the root
// <svg> via Vue's default attribute inheritance, so callers keep full control of
// styling and accessibility exactly as they did with the inline markup.
const props = withDefaults(
  defineProps<{
    /** Registry key from `src/lib/icons.ts`. */
    name: IconName
    /** Rendered width & height in px. */
    size?: number | string
    /** Override the glyph's canonical stroke width for this usage. */
    strokeWidth?: number | string
  }>(),
  { size: 24, strokeWidth: undefined },
)

const def = computed(() => icons[props.name])
const resolvedStrokeWidth = computed(() => props.strokeWidth ?? def.value.strokeWidth)
</script>
