<template>
  <div v-if="totalSets > 0" class="rrChart">
    <button class="rrHeader" :aria-expanded="!collapsed" @click="$emit('toggleCollapsed')">
      <p class="rrTitle">Rep Range Focus</p>
      <div class="rrHeaderRight">
        <span v-if="collapsed && dominant" class="rrCollapsedSummary">{{ dominant.label }}</span>
        <svg class="rrChevron" :class="{ rrChevronOpen: !collapsed }" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>

    <template v-if="!collapsed">
      <!-- Segmented distribution bar -->
      <div
        class="rrBar"
        role="img"
        :aria-label="ariaLabel"
      >
        <div
          v-for="seg in segments"
          :key="seg.id"
          class="rrSeg"
          :style="{ width: `${seg.pct}%`, opacity: seg.opacity }"
        ></div>
      </div>

      <!-- Legend -->
      <div class="rrLegend" role="list">
        <div v-for="seg in zones" :key="seg.id" class="rrLegendRow" role="listitem">
          <span class="rrSwatch" :style="{ opacity: opacityFor(seg.id) }"></span>
          <span class="rrLegendLabel">{{ seg.label }}</span>
          <span class="rrLegendRange">{{ seg.range }}</span>
          <span class="rrLegendPct">{{ pctFor(seg.sets) }}%</span>
          <span class="rrLegendSets">{{ seg.sets }} set{{ seg.sets !== 1 ? 's' : '' }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RepZone, RepZoneId } from '../composables/useRepRangeDistribution'

const props = defineProps<{
  zones: RepZone[]
  totalSets: number
  dominant: RepZone | null
  collapsed?: boolean
}>()

defineEmits<{
  toggleCollapsed: []
}>()

// Single-hue opacity tiers keep the chart on-theme across all 10 themes
// (mirrors the accent-opacity convention in MuscleGroupChart) while the
// legend carries the actual meaning of each band.
const OPACITY: Record<RepZoneId, number> = {
  strength: 1,
  hypertrophy: 0.66,
  endurance: 0.34,
}

function opacityFor(id: RepZoneId): number {
  return OPACITY[id]
}

function pctFor(sets: number): number {
  if (props.totalSets === 0) return 0
  return Math.round((sets / props.totalSets) * 100)
}

// Bar segments: skip empty zones so a zero-width sliver never renders.
const segments = computed(() =>
  props.zones
    .filter((z) => z.sets > 0)
    .map((z) => ({
      id: z.id,
      pct: (z.sets / props.totalSets) * 100,
      opacity: OPACITY[z.id],
    })),
)

const ariaLabel = computed(() => {
  const parts = props.zones.map((z) => `${z.label} ${pctFor(z.sets)} percent`)
  return `Rep range distribution across ${props.totalSets} sets: ${parts.join(', ')}`
})
</script>

<style scoped>
.rrChart {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.rrHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  color: inherit;
  font: inherit;
  min-height: 44px;
}

.rrHeader:active {
  opacity: 0.6;
}

.rrTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  text-align: left;
}

.rrHeaderRight {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.rrCollapsedSummary {
  font-size: 12px;
  color: var(--text-muted);
}

.rrChevron {
  color: var(--text-muted);
  transition: transform 0.2s;
}

.rrChevronOpen {
  transform: rotate(180deg);
}

.rrBar {
  display: flex;
  width: 100%;
  height: 16px;
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
}

.rrSeg {
  height: 100%;
  min-width: 2px;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.rrSeg:not(:last-child) {
  border-right: 1px solid var(--bg-secondary);
}

.rrLegend {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 12px;
}

.rrLegendRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.rrSwatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background-color: var(--accent);
  flex-shrink: 0;
}

.rrLegendLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.rrLegendRange {
  font-size: 11px;
  color: var(--text-muted);
}

.rrLegendPct {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-left: auto;
  width: 36px;
  text-align: right;
}

.rrLegendSets {
  font-size: 11px;
  color: var(--text-secondary);
  width: 52px;
  text-align: right;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .rrSeg {
    transition: none;
  }
  .rrChevron {
    transition: none;
  }
}
</style>
