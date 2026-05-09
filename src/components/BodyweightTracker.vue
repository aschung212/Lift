<template>
  <div class="wtCard bwCard">
    <!-- Hero header: current weight + goal hint + log button -->
    <div class="bwHero">
      <span class="bwCurrentValue">{{ store.latestWeight ? `${displayWeight(store.latestWeight)} ${weightUnit}` : 'No entries' }}</span>
      <span class="bwGoalProgressHint">{{ goalProgressText }}</span>
      <button class="wtLogBtn" @click="openModal()">+ Log</button>
    </div>

    <!-- Period selector -->
    <div v-if="store.entries.length > 0" class="bwPeriodRow">
      <button
        v-for="p in PERIODS"
        :key="p.days"
        :class="['bwPeriodBtn', { active: period === p.days }]"
        :aria-label="`Show last ${p.label === '1y' ? '1 year' : p.label.replace('d', ' days')}`"
        :aria-pressed="period === p.days ? 'true' : 'false'"
        @click="period = p.days"
      >{{ p.label }}</button>
    </div>

    <!-- Stats cards -->
    <div v-if="periodStats && periodStats.count >= 2" class="bwStatsRow">
      <div class="bwStatCard">
        <span class="bwStatLabel">Change</span>
        <span :class="['bwStatValue', changeClass(periodStats.change!)]">
          {{ displayWeight(periodStats.change!) > 0 ? '+' : '' }}{{ displayWeight(periodStats.change!) }} {{ weightUnit }}
        </span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">Low</span>
        <span class="bwStatValue">{{ displayWeight(periodStats.min) }} {{ weightUnit }}</span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">High</span>
        <span class="bwStatValue">{{ displayWeight(periodStats.max) }} {{ weightUnit }}</span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">Avg</span>
        <span class="bwStatValue">{{ displayWeight(+periodStats.avg) }} {{ weightUnit }}</span>
      </div>
    </div>
    <div v-else-if="periodStats && periodStats.count === 1" class="bwStatsSingle">
      Log at least 2 entries on different days to see trends.
    </div>

    <!-- Graph -->
    <div v-if="points.length >= 2" class="wtGraphWrap">
      <div class="bwGraphHeader">
        <p class="wtGraphTitle">Weight Over Time</p>
        <span v-if="goalLine" class="bwGoalTag">{{ goalLine.direction === 'above' ? '↑' : goalLine.direction === 'below' ? '↓' : '→' }} Goal: {{ goalLine.label }} {{ weightUnit }}</span>
        <span v-else-if="rangeBand" class="bwGoalTag">Range: {{ prefs.weightGoal.maintainMin != null ? displayWeight(prefs.weightGoal.maintainMin) : '–' }}–{{ prefs.weightGoal.maintainMax != null ? displayWeight(prefs.weightGoal.maintainMax) : '–' }} {{ weightUnit }}</span>
      </div>
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="wtGraphSvg"
        role="img"
        :aria-label="`Body weight progress chart showing ${points.length} entries from ${displayWeight(minVal)} to ${displayWeight(maxVal)} ${weightUnit}`"
      >
        <desc>{{ `Body weight trend from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${displayWeight(minVal)} to ${displayWeight(maxVal)} ${weightUnit} across ${points.length} data points.` }}</desc>
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

        <!-- Maintain range boundary lines -->
        <line
          v-if="rangeBand && rangeBand.topVisible"
          :x1="PAD_L" :y1="rangeBand.y1"
          :x2="W - PAD_R" :y2="rangeBand.y1"
          class="bwGoalLine"
        />
        <line
          v-if="rangeBand && rangeBand.bottomVisible"
          :x1="PAD_L" :y1="rangeBand.y2"
          :x2="W - PAD_R" :y2="rangeBand.y2"
          class="bwGoalLine"
        />

        <!-- Goal line (lose/gain target) — only drawn when within chart range -->
        <line
          v-if="goalLine && goalLine.direction === 'in'"
          :x1="PAD_L"
          :y1="goalLine.y"
          :x2="W - PAD_R"
          :y2="goalLine.y"
          class="bwGoalLine"
        />

        <!-- Line -->
        <polyline :points="linePoints" class="wtGLine" />

        <!-- Dots: all dots on short periods, endpoints only on long -->
        <template v-if="period <= 30">
          <circle
            v-for="p in points"
            :key="'dot-' + p.date"
            :cx="p.x"
            :cy="p.y"
            r="3"
            class="bwEndpointDot"
          />
        </template>
        <template v-else>
          <circle
            :cx="points[0].x"
            :cy="points[0].y"
            r="3"
            class="bwEndpointDot"
          />
          <circle
            :cx="points[points.length - 1].x"
            :cy="points[points.length - 1].y"
            r="3"
            class="bwEndpointDot"
          />
        </template>

        <!-- Y-axis labels -->
        <text :x="PAD_L - 5" :y="PAD_T + 4" class="wtGYLabel" text-anchor="end">{{ displayWeight(maxVal) }} {{ weightUnit }}</text>
        <text :x="PAD_L - 5" :y="PAD_T + chartH + 4" class="wtGYLabel" text-anchor="end">{{ displayWeight(minVal) }} {{ weightUnit }}</text>

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

    <!-- graph placeholder handled by bwStatsSingle above -->

    <p v-else-if="store.entries.length === 0" class="wtEmpty bwEmptyState">
      Track your weight to spot trends over time.<br />
      Weigh in at the same time each day for best accuracy.<br />
      <span class="bwEmptyCta">Tap "+ Log" above to record your first weigh-in.</span>
    </p>

    <!-- Entries list (newest first) -->
    <ul v-if="store.entries.length > 0" class="wtSetList bwEntryList">
      <li
        v-for="entry in sortedEntries"
        :key="entry.id"
        :class="['wtSetRow', entryRowClass(entry), {
          wtSetRowActive: activeEntryId === entry.id,
        }]"
        role="button"
        tabindex="0"
        :aria-expanded="activeEntryId === entry.id"
        :aria-label="`${formatDateShort(entry.date)}: ${displayWeight(entry.weight)} ${weightUnit}`"
        @click="toggleEntryActions(entry.id)"
        @keydown.enter="toggleEntryActions(entry.id)"
        @keydown.space.prevent="toggleEntryActions(entry.id)"
      >
        <span class="wtSetDate">{{ formatDateShort(entry.date) }}</span>
        <span :class="['wtSetDetail', weightClass(entry.weight)]">
          {{ displayWeight(entry.weight) }} {{ weightUnit }}
          <span v-if="entry.weight === store.minWeight" :class="['bwEntryBadge', isLowGood ? 'bwEntryBadgeGood' : 'bwEntryBadgeBad']" title="All-time low">↓ Low</span>
          <span v-else-if="entry.weight === store.maxWeight" :class="['bwEntryBadge', isHighGood ? 'bwEntryBadgeGood' : 'bwEntryBadgeBad']" title="All-time high">↑ High</span>
        </span>
        <span v-if="entryDelta(entry) != null" :class="['bwDelta', deltaClass(entry)]">
          {{ displayWeight(entryDelta(entry)!) > 0 ? '+' : '' }}{{ displayWeight(entryDelta(entry)!) }}
        </span>
        <div v-if="activeEntryId === entry.id" class="wtSetActions">
          <button class="wtSetBtn" @click.stop="openModal(entry)" aria-label="Edit entry">Edit</button>
          <button class="wtSetBtn wtSetBtnDel" @click.stop="deleteEntry(entry.id)" aria-label="Delete entry">Delete</button>
        </div>
      </li>
    </ul>
  </div>

  <!-- Log / Edit Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay" @click.self="closeModal" @keydown.escape="closeModal">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="bw-modal-title">
        <h2 id="bw-modal-title">{{ editing ? 'Edit Weight' : 'Log Weight' }}</h2>
        <p class="wtModalSubtitle">
          <span class="wtDateBtnWrap">
            <span class="wtDateMetaLabel" aria-hidden="true">{{ dateDisplay }}</span>
            <input
              v-model="date"
              type="date"
              autocomplete="off"
              :max="todayISO()"
              tabindex="-1"
              class="wtDateOverlayInput"
              :aria-label="'Log date, currently ' + dateDisplay"
              @click="tryShowDatePicker"
            />
          </span>
        </p>

        <label class="repMaxLabel">
          Weight ({{ weightUnit }})
          <div class="repMaxInputRow">
            <input
              ref="weightInputEl"
              v-model.number="weight"
              type="number"
              inputmode="decimal"
              autocomplete="off"
              min="0"
              step="any"
              placeholder="170"
              class="repMaxInput"
            />
          </div>
        </label>

        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!canSave" @click="save">
            {{ editing ? 'Save Changes' : 'Save' }}
          </button>
          <button class="repMaxBtn repMaxBtnClose" @click="closeModal">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useBodyweightStore } from '../stores/bodyweight'
import type { BodyweightEntry } from '../stores/bodyweight'
import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useUndoToast } from '../composables/useUndoToast'
import { useFocusTrap } from '../composables/useFocusTrap'
import { usePreferencesStore } from '../stores/preferences'
import { useXPCeremony } from '../composables/useXPCeremony'

const store = useBodyweightStore()
const prefs = usePreferencesStore()
const { currentTheme } = useTheme()
const { weightUnit, displayWeight, toLbs } = useWeightUnit()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { logBodyweightXPCeremony } = useXPCeremony()

// ── Modal state ──────────────────────────────────────────────────
const bwModalFocus = useFocusTrap()
const showModal = ref(false)
const editing = ref<string | null>(null) // entry id when editing
const weight = ref<number | null>(null)
const date = ref(todayISO())
const weightInputEl = ref<HTMLInputElement | null>(null)

const dateDisplay = computed(() =>
  new Date(date.value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
)

// Trigger the native date picker from a real user-gesture click. Needed
// because desktop Chrome doesn't open the picker on input-body clicks —
// only on the built-in calendar icon — and our input is opacity:0. On iOS,
// tapping the input opens its picker natively, but showPicker() within
// the gesture is a harmless no-op if the native picker is already opening.
function tryShowDatePicker(e: MouseEvent) {
  const el = e.currentTarget as HTMLInputElement
  try { el.showPicker() } catch { /* unsupported or gesture-less; native tap handles it */ }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function openModal(entry: BodyweightEntry | null = null) {
  if (entry) {
    editing.value = entry.id
    weight.value = displayWeight(entry.weight)
    date.value = isoToLocalDate(entry.date)
  } else {
    editing.value = null
    weight.value = null
    date.value = todayISO()
  }
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editing.value = null
  weight.value = null
  date.value = todayISO()
  bwModalFocus.deactivate()
}

watch(showModal, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="bw-modal-title"]')
    if (el) bwModalFocus.activate(el)
    weightInputEl.value?.focus()
  }
})

const canSave = computed(() => weight.value !== null && weight.value > 0)

function save() {
  if (!canSave.value || weight.value === null) return
  if (editing.value) {
    store.updateEntry(editing.value, toLbs(weight.value), date.value)
    logEvent('bodyweight_edit')
  } else {
    store.addEntry(toLbs(weight.value), date.value)
    logEvent('bodyweight_add')
    logBodyweightXPCeremony({ date: date.value, activeTheme: currentTheme.value })
  }
  closeModal()
}

// ── Entry actions (tap-to-reveal) ────────────────────────────────
const activeEntryId = ref<string | null>(null)

function toggleEntryActions(id: string) {
  activeEntryId.value = activeEntryId.value === id ? null : id
}

function deleteEntry(id: string) {
  const entry = store.entries.find(e => e.id === id)
  if (!entry) return
  const saved = { ...entry }
  store.deleteEntry(id, { sync: false })
  activeEntryId.value = null
  logEvent('bodyweight_delete')
  showUndo(
    'Entry deleted',
    () => store.restoreEntry(saved),
    () => store.syncDeleteEntry(id),
  )
}

// ── Period ───────────────────────────────────────────────────────
const PERIODS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y',  days: 365 },
]
const period = ref(30)

const sortedEntries = computed(() =>
  [...store.entries].sort((a, b) => b.date.localeCompare(a.date))
)

function entryDelta(entry: BodyweightEntry): number | null {
  const sorted = sortedEntries.value
  const idx = sorted.indexOf(entry)
  if (idx < 0 || idx >= sorted.length - 1) return null
  return +(entry.weight - sorted[idx + 1].weight).toFixed(1)
}

function isWeightGood(currentWeight: number, delta: number): boolean | null {
  const { direction, maintainMin, maintainMax } = prefs.weightGoal
  if (direction === 'maintain') {
    // Check against range bounds
    if (maintainMin != null && currentWeight < maintainMin) return delta > 0 // below floor, gaining is good
    if (maintainMax != null && currentWeight > maintainMax) return delta < 0 // above ceiling, losing is good
    if (maintainMin == null && maintainMax == null) return null // no range set, neutral
    return null // within range, neutral
  }
  if (delta === 0) return null
  return direction === 'lose' ? delta < 0 : delta > 0
}

function deltaClass(entry: BodyweightEntry): string {
  const delta = entryDelta(entry)
  if (delta == null || delta === 0) return ''
  const good = isWeightGood(entry.weight, delta)
  if (good == null) return ''
  return good ? 'bwDeltaGood' : 'bwDeltaBad'
}

function changeClass(change: number): string {
  if (change === 0) return ''
  const current = store.latestWeight
  if (current == null) return ''
  const good = isWeightGood(current, change)
  if (good == null) return ''
  return good ? 'bwStatGood' : 'bwStatBad'
}

// Whether hitting all-time low/high is good depends on goal direction
const goalProgressText = computed((): string => {
  const current = store.latestWeight
  if (current == null) return ''
  const { direction, loseTarget, gainTarget, maintainMin, maintainMax } = prefs.weightGoal
  if (direction === 'lose' && loseTarget != null) {
    const diff = displayWeight(Math.abs(current - loseTarget))
    if (current <= loseTarget) return `✓ At goal`
    return `↓ ${diff} ${weightUnit.value} to goal`
  }
  if (direction === 'gain' && gainTarget != null) {
    const diff = displayWeight(Math.abs(gainTarget - current))
    if (current >= gainTarget) return `✓ At goal`
    return `↑ ${diff} ${weightUnit.value} to goal`
  }
  if (direction === 'maintain') {
    if (maintainMin != null && current < maintainMin) {
      const diff = displayWeight(Math.abs(maintainMin - current))
      return `${diff} ${weightUnit.value} below range`
    }
    if (maintainMax != null && current > maintainMax) {
      const diff = displayWeight(Math.abs(current - maintainMax))
      return `${diff} ${weightUnit.value} above range`
    }
    if (maintainMin != null || maintainMax != null) return 'Within range'
  }
  return ''
})

const isLowGood = computed(() => {
  const dir = prefs.weightGoal.direction
  return dir === 'lose' // low is good when losing, bad when gaining
})
const isHighGood = computed(() => {
  const dir = prefs.weightGoal.direction
  return dir === 'gain' // high is good when gaining, bad when losing
})

function entryRowClass(entry: BodyweightEntry): string {
  const dir = prefs.weightGoal.direction
  if (entry.weight === store.minWeight) {
    if (dir === 'maintain') return ''
    return dir === 'lose' ? 'bwEntryGood' : 'bwEntryBad'
  }
  if (entry.weight === store.maxWeight) {
    if (dir === 'maintain') return ''
    return dir === 'gain' ? 'bwEntryGood' : 'bwEntryBad'
  }
  return ''
}

function weightClass(weight: number): string {
  const { direction, maintainMin, maintainMax } = prefs.weightGoal
  if (direction !== 'maintain') return ''
  if (maintainMin == null && maintainMax == null) return ''
  const belowMin = maintainMin != null && weight < maintainMin
  const aboveMax = maintainMax != null && weight > maintainMax
  if (belowMin || aboveMax) return 'bwWeightOutOfRange'
  return ''
}

// ── Graph ────────────────────────────────────────────────────────
import { useSVGTimeSeries, type TimeSeriesEntry } from '../composables/useSVGTimeSeries'

// Best (latest) weight per calendar date, sorted chronologically — all time
const dailyLatest = computed(() => {
  const byDate: Record<string, BodyweightEntry> = {}
  for (const e of store.entries) {
    const day = e.date.slice(0, 10)
    if (!byDate[day] || e.id > byDate[day].id) byDate[day] = e
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({ date, weight: e.weight }))
})

// Filtered to selected period window
const filteredDaily = computed(() => {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - period.value)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return dailyLatest.value.filter(d => d.date >= cutoffStr)
})

// Stats for the selected period
const periodStats = computed(() => {
  const entries = filteredDaily.value
  if (!entries.length) return null
  const weights = entries.map(e => e.weight)
  const min = Math.min(...weights)
  const max = Math.max(...weights)
  const avg = (weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(1)
  const change = entries.length >= 2
    ? +(entries[entries.length - 1].weight - entries[0].weight).toFixed(1)
    : null
  return { min, max, avg, change, count: entries.length }
})

// Collect all goal values that should be considered for chart range
const goalValues = computed((): number[] => {
  const { direction, loseTarget, gainTarget, maintainMin, maintainMax } = prefs.weightGoal
  const vals: number[] = []
  if (direction === 'lose' && loseTarget != null) vals.push(loseTarget)
  if (direction === 'gain' && gainTarget != null) vals.push(gainTarget)
  if (direction === 'maintain') {
    if (maintainMin != null) vals.push(maintainMin)
    if (maintainMax != null) vals.push(maintainMax)
  }
  return vals
})

// Map filtered entries to the TimeSeriesEntry shape for the composable
const graphEntries = computed((): TimeSeriesEntry[] =>
  filteredDaily.value.map(d => ({ date: d.date, value: d.weight }))
)

// Period-based time range: full selected period, not just data endpoints
const periodTimeRange = computed(() => {
  const now = new Date()
  const periodStart = new Date()
  periodStart.setDate(now.getDate() - period.value)
  return {
    t0: new Date(periodStart.toISOString().slice(0, 10) + 'T12:00:00').getTime(),
    t1: new Date(now.toISOString().slice(0, 10) + 'T12:00:00').getTime(),
  }
})

const {
  W, H, PAD_L, PAD_R, PAD_T, chartH,
  minVal, maxVal,
  points: basePoints,
  linePoints, gridYs,
  shouldShowLabel, valueToY, formatDate,
} = useSVGTimeSeries(graphEntries, {
  timeRange: periodTimeRange,
  extraYValues: goalValues,
})

// Extend base points with weight alias for template compatibility
const points = computed(() =>
  basePoints.value.map(p => ({ ...p, weight: p.value }))
)

// Goal line for lose/gain modes — clamped to chart bounds
const goalLine = computed((): { y: number; label: string; direction: 'above' | 'below' | 'in' } | null => {
  const { direction, loseTarget, gainTarget } = prefs.weightGoal
  const target = direction === 'lose' ? loseTarget : direction === 'gain' ? gainTarget : null
  if (target == null) return null
  const rawY = valueToY(target)
  const label = `${displayWeight(target)}`
  if (rawY < PAD_T) return { y: PAD_T, label, direction: 'above' }
  if (rawY > PAD_T + chartH) return { y: PAD_T + chartH, label, direction: 'below' }
  return { y: rawY, label, direction: 'in' }
})

// Range boundary lines for maintain mode
const rangeBand = computed((): { y1: number; y2: number; topVisible: boolean; bottomVisible: boolean } | null => {
  const { direction, maintainMin, maintainMax } = prefs.weightGoal
  if (direction !== 'maintain') return null
  if (maintainMin == null && maintainMax == null) return null
  const rawTop = maintainMax != null ? valueToY(maintainMax) : null
  const rawBottom = maintainMin != null ? valueToY(maintainMin) : null
  const topVisible = rawTop != null && rawTop >= PAD_T && rawTop <= PAD_T + chartH
  const bottomVisible = rawBottom != null && rawBottom >= PAD_T && rawBottom <= PAD_T + chartH
  if (!topVisible && !bottomVisible) return null
  return {
    y1: rawTop ?? PAD_T,
    y2: rawBottom ?? PAD_T + chartH,
    topVisible,
    bottomVisible,
  }
})

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>
