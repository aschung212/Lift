<template>
  <div class="wtCard bwCard">
    <div class="wtCardHeader">
      <h2 class="wtTitle">Body Weight</h2>
      <button class="wtLogBtn" @click="openModal()">+ Log</button>
    </div>

    <!-- Current weight summary -->
    <div v-if="store.latestWeight" class="bwSummary">
      <span class="bwCurrentLabel">Current</span>
      <span class="bwCurrentValue">{{ displayWeight(store.latestWeight) }} {{ weightUnit }}</span>
    </div>

    <!-- Period selector -->
    <div v-if="store.entries.length > 0" class="bwPeriodRow">
      <button
        v-for="p in PERIODS"
        :key="p.days"
        :class="['bwPeriodBtn', { active: period === p.days }]"
        @click="period = p.days"
      >{{ p.label }}</button>
    </div>

    <!-- Stats cards -->
    <div v-if="periodStats && periodStats.count >= 2" class="bwStatsRow">
      <div class="bwStatCard">
        <span class="bwStatLabel">Change</span>
        <span :class="['bwStatValue', periodStats.change! < 0 ? 'bwStatDown' : periodStats.change! > 0 ? 'bwStatUp' : '']">
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
      Only 1 entry in this period — log more to see trends.
    </div>

    <!-- Graph -->
    <div v-if="points.length >= 2" class="wtGraphWrap">
      <p class="wtGraphTitle">Weight Over Time</p>
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
          r="3.5"
          class="wtGDot"
        />

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

    <p v-else-if="store.entries.length === 1" class="wtGraphSingle">
      Log at least 2 entries on different days to see your progress graph.
    </p>

    <p v-else-if="store.entries.length === 0" class="wtEmpty">
      No entries yet. Hit "+ Log" to record your body weight.
    </p>

    <!-- Entries list (newest first) -->
    <ul v-if="store.entries.length > 0" class="wtSetList bwEntryList">
      <li
        v-for="entry in sortedEntries"
        :key="entry.id"
        :class="['wtSetRow', {
          bwEntryLow: entry.weight === store.minWeight,
          bwEntryHigh: entry.weight === store.maxWeight,
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
        <span class="wtSetDetail">
          {{ displayWeight(entry.weight) }} {{ weightUnit }}
          <span v-if="entry.weight === store.minWeight" class="bwEntryBadge bwEntryBadgeLow" title="All-time low">↓ Low</span>
          <span v-else-if="entry.weight === store.maxWeight" class="bwEntryBadge bwEntryBadgeHigh" title="All-time high">↑ High</span>
        </span>
        <span v-if="entryDelta(entry) != null" :class="['bwDelta', entryDelta(entry)! < 0 ? 'bwDeltaDown' : entryDelta(entry)! > 0 ? 'bwDeltaUp' : '']">
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

        <label class="repMaxLabel">
          Date
          <input
            v-model="date"
            type="date"
            :max="todayISO()"
            class="repMaxInput wtDateInput"
          />
        </label>

        <label class="repMaxLabel">
          Weight ({{ weightUnit }})
          <div class="repMaxInputRow">
            <input
              v-model.number="weight"
              type="number"
              inputmode="decimal"
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
import { useUndoToast } from '../composables/useUndoToast'
import { useFocusTrap } from '../composables/useFocusTrap'

const store = useBodyweightStore()
const { weightUnit, displayWeight, toLbs } = useTheme()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()

// ── Modal state ──────────────────────────────────────────────────
const bwModalFocus = useFocusTrap()
const showModal = ref(false)
const editing = ref<string | null>(null) // entry id when editing
const weight = ref<number | null>(null)
const date = ref(todayISO())

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

// ── Graph ────────────────────────────────────────────────────────
const W = 320
const H = 118
const PAD_L = 56
const PAD_R = 16
const PAD_T = 16
const PAD_B = 26
const chartW = W - PAD_L - PAD_R
const chartH = H - PAD_T - PAD_B

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

const minVal = computed(() => {
  const vals = filteredDaily.value.map(d => d.weight)
  return vals.length ? Math.min(...vals) : 0
})

const maxVal = computed(() => {
  const vals = filteredDaily.value.map(d => d.weight)
  return vals.length ? Math.max(...vals) : 0
})

const points = computed(() => {
  const entries = filteredDaily.value
  if (entries.length < 2) return []
  const range = maxVal.value - minVal.value
  // Use the full selected period for the x-axis, not just the data range
  const now = new Date()
  const periodStart = new Date()
  periodStart.setDate(now.getDate() - period.value)
  const t0 = new Date(periodStart.toISOString().slice(0, 10) + 'T12:00:00').getTime()
  const t1 = new Date(now.toISOString().slice(0, 10) + 'T12:00:00').getTime()
  const tRange = t1 - t0

  return entries.map(({ date, weight }) => {
    const t = new Date(date + 'T12:00:00').getTime()
    const x = tRange > 0 ? PAD_L + ((t - t0) / tRange) * chartW : PAD_L + chartW / 2
    const y = range > 0
      ? PAD_T + chartH - ((weight - minVal.value) / range) * chartH
      : PAD_T + chartH / 2
    return { x, y, date, weight }
  })
})

const linePoints = computed(() =>
  points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
)

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

const gridYs = computed(() => [PAD_T, PAD_T + chartH / 2, PAD_T + chartH])

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
  // Always include last point if it doesn't overlap
  const last = pts.length - 1
  if (!indices.includes(last) && pts[last].x - pts[indices[indices.length - 1]].x >= MIN_GAP) {
    indices.push(last)
  }
  return indices
})

function shouldShowLabel(i: number): boolean {
  return visibleLabelIndices.value.includes(i)
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>
