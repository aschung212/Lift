<template>
  <div v-if="totalSets > 0" class="rrChart">
    <button class="rrHeader" :aria-expanded="!collapsed" @click="$emit('toggleCollapsed')">
      <p class="rrTitle">Rep Range Distribution</p>
      <div class="rrHeaderRight">
        <span v-if="collapsed" class="rrCollapsedSummary">{{ totalSets }} sets</span>
        <svg class="rrChevron" :class="{ rrChevronOpen: !collapsed }" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>

    <template v-if="!collapsed">
      <div
        class="rrBar"
        role="img"
        :aria-label="barAriaLabel"
      >
        <div
          v-for="zone in activeZones"
          :key="zone.key"
          class="rrSegment"
          :class="`rrSegment--${zone.key}`"
          :style="{ width: `${(zone.sets / totalSets) * 100}%` }"
        ></div>
      </div>

      <div class="rrLegend" role="list">
        <div
          v-for="zone in zones"
          :key="zone.key"
          class="rrLegendRow"
          role="listitem"
          :aria-label="`${zone.label} (${zone.range}): ${zone.sets} sets, ${percent(zone.sets)}%`"
        >
          <span class="rrSwatch" :class="`rrSwatch--${zone.key}`"></span>
          <span class="rrLegendLabel">{{ zone.label }}</span>
          <span class="rrLegendRange">{{ zone.range }}</span>
          <span class="rrLegendCount">{{ zone.sets }}</span>
          <span class="rrLegendPct">{{ percent(zone.sets) }}%</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RepZone } from '../composables/useRepRangeDistribution'

const props = defineProps<{
  zones: RepZone[]
  totalSets: number
  collapsed?: boolean
}>()

defineEmits<{
  toggleCollapsed: []
}>()

// Only render segments that have sets so a zero-width sliver never appears.
const activeZones = computed(() => props.zones.filter(z => z.sets > 0))

function percent(sets: number): number {
  if (props.totalSets === 0) return 0
  return Math.round((sets / props.totalSets) * 100)
}

const barAriaLabel = computed(() => {
  const parts = props.zones
    .filter(z => z.sets > 0)
    .map(z => `${z.label} ${percent(z.sets)}%`)
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
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
}

.rrSegment {
  height: 100%;
  min-width: 2px;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.rrSegment--hypertrophy {
  opacity: 0.68;
}

.rrSegment--endurance {
  opacity: 0.36;
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
  min-height: 28px;
}

.rrSwatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
  background-color: var(--accent);
}

.rrSwatch--hypertrophy {
  opacity: 0.68;
}

.rrSwatch--endurance {
  opacity: 0.36;
}

.rrLegendLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.rrLegendRange {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
}

.rrLegendCount {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 20px;
  text-align: right;
}

.rrLegendPct {
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

@media (prefers-reduced-motion: reduce) {
  .rrSegment {
    transition: none;
  }
  .rrChevron {
    transition: none;
  }
}
</style>
