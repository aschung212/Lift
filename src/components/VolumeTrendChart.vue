<template>
  <div v-if="points.length >= 2" class="vtChart">
    <button class="vtHeader" :aria-expanded="!collapsed" @click="$emit('toggleCollapsed')">
      <p class="vtTitle">Volume Trend</p>
      <div class="vtHeaderRight">
        <span v-if="collapsed" class="vtCollapsedSummary">{{ formatVolume(totalVolume) }} {{ weightUnit }} total</span>
        <svg class="vtChevron" :class="{ vtChevronOpen: !collapsed }" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>

    <div v-if="!collapsed" class="wtGraphWrap vtGraphWrap">
      <p class="wtGraphTitle">Weekly Training Volume</p>
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="wtGraphSvg"
        role="img"
        :aria-label="`Weekly training volume chart with ${points.length} weeks, from ${formatVolume(minVal)} to ${formatVolume(maxVal)} ${weightUnit}`"
      >
        <desc>{{ `Weekly training volume from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${formatVolume(minVal)} to ${formatVolume(maxVal)} ${weightUnit} across ${points.length} weeks.` }}</desc>
        <!-- Horizontal grid lines -->
        <line
          v-for="gy in gridYs"
          :key="gy"
          :x1="PAD_L"
          :y1="gy"
          :x2="W - PAD_R"
          :y2="gy"
          class="wtGGrid"
        />

        <!-- Area fill under line -->
        <polygon :points="areaPoints" class="wtGArea" />

        <!-- Line -->
        <polyline :points="linePoints" class="wtGLine" />

        <!-- Endpoint dots -->
        <circle :cx="points[0].x" :cy="points[0].y" r="3" class="wtGDot" />
        <circle :cx="points[points.length - 1].x" :cy="points[points.length - 1].y" r="3" class="wtGDot" />

        <!-- Y-axis labels: max at top, min at bottom -->
        <text :x="PAD_L - 5" :y="PAD_T + 4" class="wtGYLabel" text-anchor="end">{{ formatVolume(maxVal) }}</text>
        <text :x="PAD_L - 5" :y="PAD_T + chartH + 4" class="wtGYLabel" text-anchor="end">{{ formatVolume(minVal) }}</text>

        <!-- X-axis date labels -->
        <text
          v-for="(p, i) in points"
          v-show="shouldShowLabel(i)"
          :key="'lbl-' + p.date"
          :x="p.x"
          :y="H - 3"
          class="wtGDateLabel"
          text-anchor="middle"
        >{{ formatDate(p.date) }}</text>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useSVGTimeSeries, type TimeSeriesEntry } from '../composables/useSVGTimeSeries'

const props = defineProps<{
  weeklyVolume: TimeSeriesEntry[]
  totalVolume: number
  collapsed?: boolean
}>()

defineEmits<{
  toggleCollapsed: []
}>()

const { weightUnit, displayWeight } = useWeightUnit()

const graphData = toRef(props, 'weeklyVolume')

const {
  W, H, PAD_L, PAD_R, PAD_T, chartH,
  minVal, maxVal, points,
  linePoints, areaPoints, gridYs,
  shouldShowLabel, formatDate,
} = useSVGTimeSeries(graphData)

/** Format a stored-lbs volume value into display units with k-abbreviation. */
function formatVolume(lbs: number): string {
  const v = displayWeight(lbs)
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}
</script>

<style scoped>
.vtChart {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.vtHeader {
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

.vtHeader:active {
  opacity: 0.6;
}

.vtTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  text-align: left;
}

.vtHeaderRight {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.vtCollapsedSummary {
  font-size: 12px;
  color: var(--text-muted);
}

.vtChevron {
  color: var(--text-muted);
  transition: transform 0.2s;
}

.vtChevronOpen {
  transform: rotate(180deg);
}

/* Override the global wtGraphWrap margin so the chart sits flush inside the card. */
.vtGraphWrap {
  margin: 8px 0 0;
}

@media (prefers-reduced-motion: reduce) {
  .vtChevron {
    transition: none;
  }
}
</style>
