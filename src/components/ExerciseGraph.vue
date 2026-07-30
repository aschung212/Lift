<template>
  <div v-if="hasGraph" class="wtGraphWrap">
    <p class="wtGraphTitle">{{ chartTitle }}</p>

    <!-- Metric selector -->
    <div class="exGraphMetricRow" role="group" aria-label="Chart metric">
      <button
        v-for="m in METRICS"
        :key="m.key"
        type="button"
        :class="['bwPeriodBtn', { active: metricKey === m.key }]"
        :aria-label="`Show ${m.title.toLowerCase()}`"
        :aria-pressed="metricKey === m.key ? 'true' : 'false'"
        @click="metricKey = m.key"
      >{{ m.label }}</button>
    </div>

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
      :aria-label="`${exercise.name} ${chartDescriptor} chart with ${points.length} data points, from ${formatValue(minVal)} to ${formatValue(maxVal)} ${unitLabel}`"
      @pointerdown="onScrubStart"
      @pointermove="onScrubMove"
      @pointerup="onScrubEnd"
      @pointercancel="onScrubEnd"
      @pointerleave="onScrubEnd"
    >
      <desc>{{ `${exercise.name} ${chartDescriptor} from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${formatValue(minVal)} to ${formatValue(maxVal)} ${unitLabel} across ${points.length} sessions.` }}</desc>
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
      >{{ formatValue(maxVal) }} {{ unitLabel }}</text>
      <text
        v-if="formatValue(midVal) !== formatValue(maxVal) && formatValue(midVal) !== formatValue(minVal)"
        :x="PAD_L - 5"
        :y="PAD_T + chartH / 2 + 4"
        class="wtGYLabel wtGYLabelMid"
        text-anchor="end"
      >{{ formatValue(midVal) }} {{ unitLabel }}</text>
      <text
        :x="PAD_L - 5"
        :y="PAD_T + chartH + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ formatValue(minVal) }} {{ unitLabel }}</text>

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
import { effectiveWeight } from '../lib/bodyweightLoad'
import type { Exercise } from '../stores/workout'

const { weightUnit, displayWeight } = useWeightUnit()
const { prBaselineDate } = usePRBaseline()

const props = defineProps<{
  exercise: Exercise
  mode?: string
}>()

const mode = computed(() => props.mode ?? 'sets')

// ── Metric switcher ──────────────────────────────────────────────
// The same date series can be reprojected onto four axes (Hevy/Jefit
// parity): estimated 1RM, heaviest top-set weight, session volume, and
// session reps. Each metric supplies how a day's sets collapse to one
// value, whether the value is a max or a per-session sum, and whether it
// reads in weight units (e1RM/weight/volume) or a bare rep count.
type MetricKey = 'e1rm' | 'weight' | 'volume' | 'reps'
interface MetricOption {
  key: MetricKey
  label: string
  title: string
  /** Reduce a day's sets to a single plotted value (canonical lbs for weight metrics). */
  aggregate: (sets: Exercise['sets']) => number
  /** Reps is a bare count; the others render in the user's weight unit. */
  isWeight: boolean
}
const METRICS: MetricOption[] = [
  {
    key: 'e1rm',
    label: 'e1RM',
    title: 'Estimated 1RM',
    aggregate: sets => Math.max(...sets.map(s => s.estimated1RM)),
    isWeight: true,
  },
  {
    key: 'weight',
    label: 'Weight',
    title: 'Max Weight',
    aggregate: sets => Math.max(...sets.map(effectiveWeight)),
    isWeight: true,
  },
  {
    key: 'volume',
    label: 'Volume',
    title: 'Total Volume',
    aggregate: sets => sets.reduce((sum, s) => sum + effectiveWeight(s) * s.reps, 0),
    isWeight: true,
  },
  {
    key: 'reps',
    label: 'Reps',
    title: 'Total Reps',
    aggregate: sets => sets.reduce((sum, s) => sum + s.reps, 0),
    isWeight: false,
  },
]
const metricKey = ref<MetricKey>('e1rm')
const currentMetric = computed(() => METRICS.find(m => m.key === metricKey.value) ?? METRICS[0])

/** Chart title reflects both the milestone mode and the active metric. */
const chartTitle = computed(() =>
  mode.value === 'prs' ? `${currentMetric.value.title} PRs` : `${currentMetric.value.title} Progress`,
)
/** Phrase for aria-label/desc, e.g. "Estimated 1RM progress" or "Total Volume PRs". */
const chartDescriptor = computed(() =>
  `${currentMetric.value.title}${mode.value === 'prs' ? ' PRs' : ' progress'}`,
)

/** Format a plotted value for labels: weight metrics honour the unit converter,
 *  reps stay a rounded bare count. */
function formatValue(v: number): string {
  return currentMetric.value.isWeight ? String(displayWeight(v)) : String(Math.round(v))
}
/** Unit suffix shown after values ("lbs"/"kg" for weight metrics, "reps" otherwise). */
const unitLabel = computed(() => (currentMetric.value.isWeight ? weightUnit.value : 'reps'))

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

// One aggregated value per calendar date for the active metric, sorted
// chronologically. Filters to sets on/after the PR baseline when set — keeps the
// graph aligned with the user's current training block view.
const dailyValues = computed((): [string, number][] => {
  const byDate: Record<string, Exercise['sets']> = {}
  const baseline = prBaselineDate.value
  for (const s of props.exercise.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
    if (baseline && day < baseline) continue
    ;(byDate[day] ??= []).push(s)
  }
  const aggregate = currentMetric.value.aggregate
  return Object.entries(byDate)
    .map(([day, sets]): [string, number] => [day, aggregate(sets)])
    .sort(([a], [b]) => a.localeCompare(b))
})

const prOnly = computed((): [string, number][] => {
  const entries = dailyValues.value
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
  const raw = mode.value === 'prs' ? prOnly.value : dailyValues.value
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
  const label = `${formatValue(p.value)} ${unitLabel.value} · ${formatDate(p.date)}`
  return { point: p, label, box: readoutBox(p, label) }
})
</script>
