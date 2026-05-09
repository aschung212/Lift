<template>
  <div v-if="points.length >= 2" class="wtGraphWrap">
    <p class="wtGraphTitle">{{ mode === 'prs' ? 'PR Progression' : 'Estimated 1RM Progress' }}</p>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="wtGraphSvg"
      role="img"
      :aria-label="`${exercise.name} ${mode === 'prs' ? 'PR progression' : 'estimated 1RM progress'} chart with ${points.length} data points, from ${displayWeight(minVal)} to ${displayWeight(maxVal)} ${weightUnit}`"
    >
      <desc>{{ `${exercise.name} ${mode === 'prs' ? 'PR progression' : 'estimated 1RM progress'} from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${displayWeight(minVal)} to ${displayWeight(maxVal)} ${weightUnit} across ${points.length} sessions.` }}</desc>
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

      <!-- Dots -->
      <circle
        v-for="p in points"
        :key="'dot-' + p.date"
        :cx="p.x"
        :cy="p.y"
        :r="p.isPR ? 5 : 3.5"
        :class="p.isPR ? 'wtGDotPR' : 'wtGDot'"
      />

      <!-- PR label above PR dot -->
      <text
        v-for="p in points"
        v-show="p.isPR"
        :key="'pr-' + p.date"
        :x="p.x"
        :y="p.y - 10"
        class="wtGPRLabel"
        text-anchor="middle"
      >PR</text>

      <!-- Y-axis labels: max at top, min at bottom -->
      <text
        :x="PAD_L - 5"
        :y="PAD_T + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ displayWeight(maxVal) }} {{ weightUnit }}</text>
      <text
        :x="PAD_L - 5"
        :y="PAD_T + chartH + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ displayWeight(minVal) }} {{ weightUnit }}</text>

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

  <p v-else-if="exercise.sets.length > 0" class="wtGraphSingle">
    Log sets on at least 2 different days to see your progress graph.
  </p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../composables/useTheme'
import { usePRBaseline } from '../composables/usePRBaseline'
import {
  useSVGTimeSeries,
  formatGraphDate as formatDate,
  GRAPH_W as W,
  GRAPH_H as H,
  GRAPH_PAD_L as PAD_L,
  GRAPH_PAD_R as PAD_R,
  GRAPH_PAD_T as PAD_T,
  CHART_H as chartH,
} from '../composables/useSVGTimeSeries'
import type { Exercise } from '../stores/workout'

const { weightUnit, displayWeight } = useTheme()
const { prBaselineDate } = usePRBaseline()

const props = defineProps<{
  exercise: Exercise
  mode?: string
}>()

const mode = computed(() => props.mode ?? 'sets')

// Best estimated1RM per calendar date, sorted chronologically.
// Filters to sets on/after the PR baseline when set — keeps the graph aligned
// with the user's current training block view.
const dailyBest = computed((): [string, number][] => {
  const byDate: Record<string, number> = {}
  const baseline = prBaselineDate.value
  for (const s of props.exercise.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
    if (baseline && day < baseline) continue
    if (!byDate[day] || s.estimated1RM > byDate[day]) {
      byDate[day] = s.estimated1RM
    }
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
})

const prOnly = computed((): [string, number][] => {
  const entries = dailyBest.value
  const prs: [string, number][] = []
  let max = 0
  for (const [date, e1rm] of entries) {
    if (e1rm > max) {
      max = e1rm
      prs.push([date, e1rm])
    }
  }
  return prs
})

const graphData = computed(() =>
  mode.value === 'prs' ? prOnly.value : dailyBest.value
)

// Map domain data to TimeSeriesEntry format for the composable
const timeSeriesEntries = computed(() =>
  graphData.value.map(([date, value]) => ({ date, value }))
)

const {
  minVal, maxVal, coords, linePoints, areaPoints, gridYs, visibleLabelIndices,
} = useSVGTimeSeries({ entries: timeSeriesEntries })

// Enrich coords with domain-specific fields (e1rm, isPR)
const points = computed(() => {
  const data = graphData.value
  const mapped = coords.value
  if (mapped.length === 0) return []
  // Find the earliest date that hit the max value
  const prDate = data.find(([, v]) => v === maxVal.value)?.[0] ?? ''
  return mapped.map((c, i) => ({
    x: c.x,
    y: c.y,
    date: data[i][0],
    e1rm: data[i][1],
    isPR: data[i][0] === prDate,
  }))
})

function shouldShowLabel(i: number) {
  return visibleLabelIndices.value.includes(i)
}
</script>
