<template>
  <div v-if="hasGraph" class="wtGraphWrap">
    <p class="wtGraphTitle">{{ mode === 'prs' ? 'PR Progression' : 'Estimated 1RM Progress' }}</p>

    <!-- Time-range selector -->
    <div class="exGraphPeriodRow" role="group" aria-label="Chart time range">
      <button
        v-for="p in PERIODS"
        :key="p.label"
        type="button"
        :class="['bwPeriodBtn', { active: period === p.days }]"
        :aria-label="rangeAriaLabel(p)"
        :aria-pressed="period === p.days ? 'true' : 'false'"
        @click="period = p.days"
      >{{ p.label }}</button>
    </div>

    <svg
      v-if="points.length >= 2"
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="wtGraphSvg"
      role="img"
      :aria-label="`${exercise.name} ${mode === 'prs' ? 'PR progression' : 'estimated 1RM progress'} chart with ${points.length} data points, from ${displayWeight(minVal)} to ${displayWeight(maxVal)} ${weightUnit}`"
      @pointerdown="onScrubStart"
      @pointermove="onScrubMove"
      @pointerup="onScrubEnd"
      @pointercancel="onScrubEnd"
      @pointerleave="onScrubEnd"
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

      <!-- Y-axis labels: max at top, midpoint, min at bottom -->
      <text
        :x="PAD_L - 5"
        :y="PAD_T + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ displayWeight(maxVal) }} {{ weightUnit }}</text>
      <text
        v-if="displayWeight(midVal) !== displayWeight(maxVal) && displayWeight(midVal) !== displayWeight(minVal)"
        :x="PAD_L - 5"
        :y="PAD_T + chartH / 2 + 4"
        class="wtGYLabel wtGYLabelMid"
        text-anchor="end"
      >{{ displayWeight(midVal) }} {{ weightUnit }}</text>
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

      <!-- Touch-scrub readout: crosshair + value bubble at the inspected point -->
      <g v-if="readout" class="wtGScrub" aria-hidden="true">
        <line
          :x1="readout.point.x"
          :y1="PAD_T"
          :x2="readout.point.x"
          :y2="PAD_T + chartH"
          class="wtGScrubLine"
        />
        <circle :cx="readout.point.x" :cy="readout.point.y" r="4.5" class="wtGScrubDot" />
        <rect
          :x="readout.box.x"
          :y="readout.box.y"
          :width="readout.box.w"
          :height="readout.box.h"
          rx="5"
          class="wtGReadoutBox"
        />
        <text :x="readout.box.tx" :y="readout.box.ty" class="wtGReadoutText" text-anchor="middle">{{ readout.label }}</text>
      </g>
    </svg>

    <p v-else class="exGraphRangeEmpty">No sets in this range. Try a longer range.</p>
  </div>

  <p v-else-if="exercise.sets.length > 0" class="wtGraphSingle">
    Log sets on at least 2 different days to see your progress graph.
  </p>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWeightUnit } from '../composables/useWeightUnit'
import { usePRBaseline } from '../composables/usePRBaseline'
import { useSVGTimeSeries, type TimeSeriesEntry } from '../composables/useSVGTimeSeries'
import { useChartScrubber } from '../composables/useChartScrubber'
import type { Exercise } from '../stores/workout'

const { weightUnit, displayWeight } = useWeightUnit()
const { prBaselineDate } = usePRBaseline()

const props = defineProps<{
  exercise: Exercise
  mode?: string
}>()

const mode = computed(() => props.mode ?? 'sets')

// ── Time-range selector ──────────────────────────────────────────
// Long-trained lifts compress the whole-history curve and hide recent
// progress; scoping to a window keeps recent sessions legible. Defaults
// to "All" to preserve the original full-history view.
interface RangeOption { label: string; days: number | null }
const PERIODS: RangeOption[] = [
  { label: '1M',  days: 30 },
  { label: '3M',  days: 90 },
  { label: '1Y',  days: 365 },
  { label: 'All', days: null },
]
const period = ref<number | null>(null)

function rangeAriaLabel(p: RangeOption): string {
  if (p.days === null) return 'Show all time'
  if (p.days === 30) return 'Show last 1 month'
  if (p.days === 90) return 'Show last 3 months'
  if (p.days === 365) return 'Show last 1 year'
  return `Show last ${p.days} days`
}

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

const graphDataAll = computed((): TimeSeriesEntry[] => {
  const raw = mode.value === 'prs' ? prOnly.value : dailyBest.value
  return raw.map(([date, value]) => ({ date, value }))
})

// Cutoff date (YYYY-MM-DD) for the selected window, or null for all-time.
const cutoffDate = computed((): string | null => {
  if (period.value === null) return null
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - period.value)
  return cutoff.toISOString().slice(0, 10)
})

const graphData = computed((): TimeSeriesEntry[] => {
  const cutoff = cutoffDate.value
  if (!cutoff) return graphDataAll.value
  return graphDataAll.value.filter(d => d.date.slice(0, 10) >= cutoff)
})

// Whether there is enough history to render a chart at all (independent of the
// selected range), so the range selector stays visible even when a narrow
// window has too few points.
const hasGraph = computed(() => graphDataAll.value.length >= 2)

// Scope the time axis to the full selected window so a sparse recent stretch
// still spans the chart rather than bunching at one edge. Null = data-derived.
const periodTimeRange = computed(() => {
  if (period.value === null) return null
  const now = new Date()
  const start = new Date()
  start.setDate(now.getDate() - period.value)
  return {
    t0: new Date(start.toISOString().slice(0, 10) + 'T12:00:00').getTime(),
    t1: new Date(now.toISOString().slice(0, 10) + 'T12:00:00').getTime(),
  }
})

const {
  W, H, PAD_L, PAD_R, PAD_T, chartH,
  minVal, maxVal, midVal, points: basePoints,
  linePoints, areaPoints, gridYs,
  shouldShowLabel, formatDate, readoutBox,
} = useSVGTimeSeries(graphData, { timeRange: periodTimeRange })

// Earliest date that hit the all-time best value, derived from full history
// (not the windowed view) so narrowing the range never mislabels a merely
// window-best set as an all-time PR.
const allTimePRDate = computed((): string => {
  let max = -Infinity
  let date = ''
  for (const entry of graphDataAll.value) {
    if (entry.value > max) {
      max = entry.value
      date = entry.date
    }
  }
  return date
})

// Extend base points with exercise-specific PR flag. The PR badge only renders
// when the all-time best session falls inside the selected window.
const points = computed(() => {
  const pts = basePoints.value
  if (!pts.length) return []
  const prDate = allTimePRDate.value
  return pts.map(p => ({
    ...p,
    e1rm: p.value,
    isPR: p.date === prDate,
  }))
})

// Touch-scrub to inspect the exact value/date at any data point.
const svgEl = ref<SVGSVGElement | null>(null)
const { activeIndex, onScrubStart, onScrubMove, onScrubEnd } = useChartScrubber(points, svgEl, W)

const readout = computed(() => {
  const i = activeIndex.value
  if (i == null) return null
  const p = points.value[i]
  if (!p) return null
  const label = `${displayWeight(p.value)} ${weightUnit.value} · ${formatDate(p.date)}`
  return { point: p, label, box: readoutBox(p, label) }
})
</script>
