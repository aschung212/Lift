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
import type { Exercise } from '../stores/workout'

const { weightUnit, displayWeight } = useTheme()

const props = defineProps<{
  exercise: Exercise
  mode?: string
}>()

const mode = computed(() => props.mode ?? 'sets')

// SVG layout constants
const W = 320
const H = 118
const PAD_L = 56
const PAD_R = 16
const PAD_T = 16
const PAD_B = 26
const chartW = W - PAD_L - PAD_R
const chartH = H - PAD_T - PAD_B

// Best estimated1RM per calendar date, sorted chronologically
const dailyBest = computed((): [string, number][] => {
  const byDate: Record<string, number> = {}
  for (const s of props.exercise.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
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

const minVal = computed(() => {
  const vals = graphData.value.map(([, v]) => v)
  return vals.length ? Math.min(...vals) : 0
})

const maxVal = computed(() => {
  const vals = graphData.value.map(([, v]) => v)
  return vals.length ? Math.max(...vals) : 0
})

// Map each date → {x, y, date, e1rm, isPR}
// Only the first date to reach the max e1RM is marked as PR
const points = computed(() => {
  const entries = graphData.value
  if (entries.length < 2) return []
  const range = maxVal.value - minVal.value
  const t0 = new Date(entries[0][0] + 'T12:00:00').getTime()
  const t1 = new Date(entries[entries.length - 1][0] + 'T12:00:00').getTime()
  const tRange = t1 - t0
  // Find the earliest date that hit the max value
  const prDate = entries.find(([, v]) => v === maxVal.value)?.[0] ?? ''

  return entries.map(([date, e1rm]) => {
    const t = new Date(date + 'T12:00:00').getTime()
    const x = tRange > 0 ? PAD_L + ((t - t0) / tRange) * chartW : PAD_L + chartW / 2
    const y = range > 0
      ? PAD_T + chartH - ((e1rm - minVal.value) / range) * chartH
      : PAD_T + chartH / 2
    return { x, y, date, e1rm, isPR: date === prDate }
  })
})

// SVG polyline points string
const linePoints = computed(() =>
  points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
)

// Closed polygon for the shaded area under the line
const areaPoints = computed(() => {
  const pts = points.value
  if (!pts.length) return ''
  const bottom = PAD_T + chartH
  return [
    `${pts[0].x.toFixed(1)},${bottom}`,
    ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${pts[pts.length - 1].x.toFixed(1)},${bottom}`
  ].join(' ')
})

// Horizontal guide lines (top, middle, bottom of chart)
const gridYs = computed(() => [
  PAD_T,
  PAD_T + chartH / 2,
  PAD_T + chartH
])

const visibleLabelIndices = computed(() => {
  const pts = points.value
  if (pts.length === 0) return []
  const MIN_GAP = 50
  const indices = [0]
  for (let i = 1; i < pts.length; i++) {
    const lastX = pts[indices[indices.length - 1]].x
    if (pts[i].x - lastX >= MIN_GAP) {
      indices.push(i)
    }
  }
  const last = pts.length - 1
  if (!indices.includes(last) && pts[last].x - pts[indices[indices.length - 1]].x >= MIN_GAP) {
    indices.push(last)
  }
  return indices
})

function shouldShowLabel(i: number) {
  return visibleLabelIndices.value.includes(i)
}

function formatDate(iso: string) {
  // Append noon to avoid off-by-one-day from UTC midnight
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}
</script>
