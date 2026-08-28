<template>
  <div v-if="hasGraph" class="wtGraphWrap">
    <p class="wtGraphTitle">
      {{ graphTitle }}
      <span
        v-if="plateau.isPlateau"
        class="wtGraphPlateauBadge"
        :aria-label="plateauLabel"
        :title="plateauLabel"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Plateau
      </span>
    </p>

    <!-- Metric selector -->
    <div class="exGraphMetricRow" role="group" aria-label="Chart metric">
      <button
        v-for="m in METRICS"
        :key="m.key"
        type="button"
        :class="['bwPeriodBtn', { active: metric === m.key }]"
        :aria-label="`Show ${m.label}`"
        :aria-pressed="metric === m.key ? 'true' : 'false'"
        @click="metric = m.key"
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
      :aria-label="`${exercise.name} ${metricNoun} chart with ${points.length} data points, from ${metricLabel(minVal)} to ${metricLabel(maxVal)}`"
      @pointerdown="onScrubStart"
      @pointermove="onScrubMove"
      @pointerup="onScrubEnd"
      @pointercancel="onScrubEnd"
      @pointerleave="onScrubEnd"
    >
      <desc>{{ `${exercise.name} ${metricNoun} from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${metricLabel(minVal)} to ${metricLabel(maxVal)} across ${points.length} sessions.` }}</desc>
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
      >{{ metricLabel(maxVal) }}</text>
      <text
        v-if="metricLabel(midVal) !== metricLabel(maxVal) && metricLabel(midVal) !== metricLabel(minVal)"
        :x="PAD_L - 5"
        :y="PAD_T + chartH / 2 + 4"
        class="wtGYLabel wtGYLabelMid"
        text-anchor="end"
      >{{ metricLabel(midVal) }}</text>
      <text
        :x="PAD_L - 5"
        :y="PAD_T + chartH + 4"
        class="wtGYLabel"
        text-anchor="end"
      >{{ metricLabel(minVal) }}</text>

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
import { detectPlateau } from '../lib/plateau'
import type { Exercise } from '../stores/workout'
import { effectiveSetWeight } from '../lib/bodyweightLoad'

const { weightUnit, displayWeight } = useWeightUnit()
const { prBaselineDate } = usePRBaseline()

const props = defineProps<{
  exercise: Exercise
  mode?: string
}>()

const mode = computed(() => props.mode ?? 'sets')

// ── Metric selector ──────────────────────────────────────────────
// The chart plots one metric on the Y axis at a time. e1RM is the default
// (preserving the original view); users can reproject the same date series
// onto max weight, total session volume, or total reps — the same affordance
// Hevy/Jefit expose. `weight`/`volume` stay in weight units (kg/lb aware);
// `reps` is a raw count.
type Metric = 'e1rm' | 'weight' | 'volume' | 'reps'
interface MetricOption { key: Metric; label: string }
const METRICS: MetricOption[] = [
  { key: 'e1rm', label: 'e1RM' },
  { key: 'weight', label: 'Weight' },
  { key: 'volume', label: 'Volume' },
  { key: 'reps', label: 'Reps' },
]
const metric = ref<Metric>('e1rm')
const isCountMetric = computed(() => metric.value === 'reps')

/** Human-readable noun for the active metric, used in aria/desc text. */
const metricNoun = computed((): string => {
  switch (metric.value) {
    case 'weight': return 'max weight'
    case 'volume': return 'total volume'
    case 'reps': return 'total reps'
    default: return mode.value === 'prs' ? 'PR progression' : 'estimated 1RM progress'
  }
})

/** Card heading for the active metric (mode-aware for e1RM only). */
const graphTitle = computed((): string => {
  switch (metric.value) {
    case 'weight': return 'Max Weight'
    case 'volume': return 'Total Volume'
    case 'reps': return 'Total Reps'
    default: return mode.value === 'prs' ? 'PR Progression' : 'Estimated 1RM Progress'
  }
})

/** Format a metric value for axis/readout labels — unit-aware for weight
 *  metrics (kg/lb conversion), a raw rounded count for reps. */
function metricLabel(value: number): string {
  if (isCountMetric.value) return `${Math.round(value)} reps`
  return `${displayWeight(value)} ${weightUnit.value}`
}

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

// The active metric aggregated per calendar date, sorted chronologically.
// e1RM/weight take the best (max) of the day; volume/reps sum the day's sets.
// Filters to sets on/after the PR baseline when set — keeps the graph aligned
// with the user's current training block view.
// Weight/volume use the bodyweight-inclusive effective load (LIFT-834) so a
// bodyweight-loaded lift (weighted pull-ups) charts consistently with its e1RM
// metric — which already stores the folded load — instead of only the added
// plate weight. effectiveSetWeight is exactly `s.weight` for normal exercises.
const dailyBest = computed((): [string, number][] => {
  const byDate: Record<string, number> = {}
  const baseline = prBaselineDate.value
  const m = metric.value
  const ex = props.exercise
  for (const s of ex.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
    if (baseline && day < baseline) continue
    if (m === 'volume') {
      byDate[day] = (byDate[day] ?? 0) + effectiveSetWeight(s, ex) * s.reps
    } else if (m === 'reps') {
      byDate[day] = (byDate[day] ?? 0) + s.reps
    } else {
      const v = m === 'weight' ? effectiveSetWeight(s, ex) : s.estimated1RM
      if (byDate[day] === undefined || v > byDate[day]) byDate[day] = v
    }
  }
  return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
})

// Plateau/stall detection (LIFT-1025). Pinned to the daily-best e1RM series
// (baseline-scoped, but independent of the selected metric, the graph's mode,
// and the time window) so the badge reflects genuine strength stagnation in
// the current training block — `dailyBest` can't be used here because it
// reprojects onto whatever metric the selector shows (volume, reps, …).
const dailyBestE1RM = computed((): { date: string; value: number }[] => {
  const byDate: Record<string, number> = {}
  const baseline = prBaselineDate.value
  for (const s of props.exercise.sets) {
    const day = s.date.slice(0, 10) // YYYY-MM-DD
    if (baseline && day < baseline) continue
    if (byDate[day] === undefined || s.estimated1RM > byDate[day]) byDate[day] = s.estimated1RM
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))
})

const plateau = computed(() => detectPlateau(dailyBestE1RM.value))

const plateauLabel = computed(
  () => `No new estimated 1RM best in the last ${plateau.value.sessionsStalled} sessions`
)

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
  const label = `${metricLabel(p.value)} · ${formatDate(p.date)}`
  return { point: p, label, box: readoutBox(p, label) }
})
</script>
