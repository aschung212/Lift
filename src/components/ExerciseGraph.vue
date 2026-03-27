<template>
  <div v-if="points.length >= 2" class="wtGraphWrap">
    <p class="wtGraphTitle">Estimated 1RM Progress</p>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="wtGraphSvg"
      role="img"
      :aria-label="`Estimated 1RM progress chart`"
    >
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
      >{{ maxVal }} lbs</text>
      <text
        :x="PAD_L - 5"
        :y="PAD_T + chartH + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ minVal }} lbs</text>

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

<script setup>
import { computed } from 'vue'

const props = defineProps({
  exercise: { type: Object, required: true }
})

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
const dailyBest = computed(() => {
  const byDate = {}
  for (const s of props.exercise.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
    if (!byDate[day] || s.estimated1RM > byDate[day]) {
      byDate[day] = s.estimated1RM
    }
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
})

const minVal = computed(() => {
  const vals = dailyBest.value.map(([, v]) => v)
  return vals.length ? Math.min(...vals) : 0
})

const maxVal = computed(() => {
  const vals = dailyBest.value.map(([, v]) => v)
  return vals.length ? Math.max(...vals) : 0
})

// Map each date → {x, y, date, e1rm, isPR}
const points = computed(() => {
  const entries = dailyBest.value
  if (entries.length < 2) return []
  const n = entries.length
  const range = maxVal.value - minVal.value

  return entries.map(([date, e1rm], i) => {
    const x = PAD_L + (i / (n - 1)) * chartW
    const y = range > 0
      ? PAD_T + chartH - ((e1rm - minVal.value) / range) * chartH
      : PAD_T + chartH / 2
    return { x, y, date, e1rm, isPR: e1rm === maxVal.value }
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

// Show x-axis date labels for every point up to 5, else first/mid/last
function shouldShowLabel(i) {
  const n = points.value.length
  if (n <= 5) return true
  return i === 0 || i === Math.floor((n - 1) / 2) || i === n - 1
}

function formatDate(iso) {
  // Append noon to avoid off-by-one-day from UTC midnight
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}
</script>
