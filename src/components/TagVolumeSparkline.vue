<template>
  <div v-if="points.length >= 2" class="mgSparkline wtGraphWrap">
    <p class="wtGraphTitle">{{ tag }} weekly volume</p>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="wtGraphSvg"
      role="img"
      :aria-label="`${tag} weekly volume trend across ${points.length} weeks, from ${formatVolume(minVal)} to ${formatVolume(maxVal)} ${weightUnit}`"
    >
      <desc>{{ `${tag} weekly training volume from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${formatVolume(minVal)} to ${formatVolume(maxVal)} ${weightUnit}.` }}</desc>
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
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useSVGTimeSeries, type TimeSeriesEntry } from '../composables/useSVGTimeSeries'

const props = defineProps<{
  /** Weekly volume series (stored lbs) for a single tag. */
  series: TimeSeriesEntry[]
  /** Tag name, used for titles and the accessible label. */
  tag: string
}>()

const { weightUnit, displayWeight } = useWeightUnit()

const graphData = toRef(props, 'series')

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
/* Override the global wtGraphWrap margin so the sparkline sits flush under the row. */
.mgSparkline {
  margin: 4px 0 8px;
}
</style>
