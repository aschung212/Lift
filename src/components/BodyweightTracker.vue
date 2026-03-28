<template>
  <div class="wtCard bwCard">
    <div class="wtCardHeader">
      <h2 class="wtTitle">Body Weight</h2>
      <button class="wtLogBtn" @click="openModal()">+ Log</button>
    </div>

    <!-- Current weight summary -->
    <div v-if="store.latestWeight" class="bwSummary">
      <span class="bwCurrentLabel">Current</span>
      <span class="bwCurrentValue">{{ store.latestWeight }} lbs</span>
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
        <span :class="['bwStatValue', periodStats.change < 0 ? 'bwStatDown' : periodStats.change > 0 ? 'bwStatUp' : '']">
          {{ periodStats.change > 0 ? '+' : '' }}{{ periodStats.change.toFixed(1) }} lbs
        </span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">Low</span>
        <span class="bwStatValue">{{ periodStats.min }} lbs</span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">High</span>
        <span class="bwStatValue">{{ periodStats.max }} lbs</span>
      </div>
      <div class="bwStatCard">
        <span class="bwStatLabel">Avg</span>
        <span class="bwStatValue">{{ periodStats.avg }} lbs</span>
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
        aria-label="Body weight progress chart"
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
          r="3.5"
          class="wtGDot"
        />

        <!-- Y-axis labels -->
        <text :x="PAD_L - 5" :y="PAD_T + 4" class="wtGYLabel" text-anchor="end">{{ maxVal }} lbs</text>
        <text :x="PAD_L - 5" :y="PAD_T + chartH + 4" class="wtGYLabel" text-anchor="end">{{ minVal }} lbs</text>

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
        v-for="entry in [...store.entries].reverse()"
        :key="entry.id"
        class="wtSetRow"
      >
        <span class="wtSetDate">{{ formatDateShort(entry.date) }}</span>
        <span class="wtSetDetail">{{ entry.weight }} lbs</span>
        <div class="wtSetActions">
          <button class="wtSetBtn" @click.stop="openModal(entry)" aria-label="Edit entry">Edit</button>
          <button class="wtSetBtn wtSetBtnDel" @click.stop="store.deleteEntry(entry.id)" aria-label="Delete entry">Delete</button>
        </div>
      </li>
    </ul>
  </div>

  <!-- Log / Edit Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay" @click.self="closeModal">
      <div class="repMaxModal">
        <h2>{{ editing ? 'Edit Weight' : 'Log Weight' }}</h2>

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
          Weight
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
            <span class="repMaxUnit">lbs</span>
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

<script setup>
import { ref, computed } from 'vue'
import { useBodyweightStore } from '../stores/bodyweight'

const store = useBodyweightStore()

// ── Modal state ──────────────────────────────────────────────────
const showModal = ref(false)
const editing = ref(null) // entry id when editing
const weight = ref(null)
const date = ref(todayISO())

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function isoToLocalDate(iso) {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function openModal(entry = null) {
  if (entry) {
    editing.value = entry.id
    weight.value = entry.weight
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
}

const canSave = computed(() => weight.value > 0)

function save() {
  if (!canSave.value) return
  if (editing.value) {
    store.updateEntry(editing.value, weight.value, date.value)
  } else {
    store.addEntry(weight.value, date.value)
  }
  closeModal()
}

// ── Period ───────────────────────────────────────────────────────
const PERIODS = [
  { label: '7d',  days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y',  days: 365 },
]
const period = ref(30)

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
  const byDate = {}
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
  const n = entries.length
  const range = maxVal.value - minVal.value

  return entries.map(({ date, weight }, i) => {
    const x = PAD_L + (i / (n - 1)) * chartW
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

function shouldShowLabel(i) {
  const n = points.value.length
  if (n <= 5) return true
  return i === 0 || i === Math.floor((n - 1) / 2) || i === n - 1
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>
