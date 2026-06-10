<template>
  <div class="wtCard bwCard bmCard">
    <!-- Header -->
    <div class="bmHeader">
      <p class="wtGraphTitle bmTitle">Measurements</p>
    </div>

    <!-- Measurement type selector -->
    <div class="bwPeriodRow bmTypeRow" role="tablist" aria-label="Body measurement">
      <button
        v-for="t in TYPES"
        :key="t.id"
        role="tab"
        :class="['bwPeriodBtn bmTypeBtn', { active: selectedType === t.id }]"
        :aria-label="`Show ${t.label} measurements`"
        :aria-selected="selectedType === t.id ? 'true' : 'false'"
        @click="selectType(t.id)"
      >{{ t.label }}</button>
    </div>

    <!-- Hero: latest value + log button -->
    <div class="bwHero bmHero">
      <span class="bwCurrentValue">{{ latest != null ? `${displayLen(latest)} ${lengthUnit}` : 'No entries' }}</span>
      <span v-if="latestDelta != null" class="bwGoalProgressHint">
        {{ latestDelta > 0 ? '+' : '' }}{{ displayLen(latestDelta) }} {{ lengthUnit }} since previous
      </span>
      <button class="wtLogBtn" @click="openModal()">+ Log</button>
    </div>

    <!-- Period selector -->
    <div v-if="typeEntries.length > 0" class="bwPeriodRow">
      <button
        v-for="p in PERIODS"
        :key="p.days"
        :class="['bwPeriodBtn', { active: period === p.days }]"
        :aria-label="`Show last ${p.label === '1y' ? '1 year' : p.label.replace('d', ' days')}`"
        :aria-pressed="period === p.days ? 'true' : 'false'"
        @click="period = p.days"
      >{{ p.label }}</button>
    </div>

    <!-- Graph -->
    <div v-if="points.length >= 2" class="wtGraphWrap">
      <svg
        :viewBox="`0 0 ${W} ${H}`"
        class="wtGraphSvg"
        role="img"
        :aria-label="`${selectedLabel} measurement chart showing ${points.length} entries from ${displayLen(minVal)} to ${displayLen(maxVal)} ${lengthUnit}`"
      >
        <desc>{{ `${selectedLabel} trend from ${formatDate(points[0]?.date)} to ${formatDate(points[points.length - 1]?.date)}, ranging from ${displayLen(minVal)} to ${displayLen(maxVal)} ${lengthUnit} across ${points.length} data points.` }}</desc>
        <line
          v-for="gy in gridYs"
          :key="gy"
          :x1="PAD_L"
          :y1="gy"
          :x2="W - PAD_R"
          :y2="gy"
          class="wtGGrid"
        />
        <polyline :points="linePoints" class="wtGLine" />
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
          <circle :cx="points[0].x" :cy="points[0].y" r="3" class="bwEndpointDot" />
          <circle :cx="points[points.length - 1].x" :cy="points[points.length - 1].y" r="3" class="bwEndpointDot" />
        </template>
        <text :x="PAD_L - 5" :y="PAD_T + 4" class="wtGYLabel" text-anchor="end">{{ displayLen(maxVal) }} {{ lengthUnit }}</text>
        <text :x="PAD_L - 5" :y="PAD_T + chartH + 4" class="wtGYLabel" text-anchor="end">{{ displayLen(minVal) }} {{ lengthUnit }}</text>
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

    <p v-else-if="typeEntries.length === 0" class="wtEmpty bwEmptyState">
      Track your {{ selectedLabel.toLowerCase() }} circumference to see how it changes over time.<br />
      <span class="bwEmptyCta">Tap "+ Log" above to record your first measurement.</span>
    </p>
    <div v-else class="bwStatsSingle">
      Log at least 2 entries on different days to see a trend.
    </div>

    <!-- Entries list (newest first) -->
    <ul v-if="typeEntries.length > 0" class="wtSetList bwEntryList">
      <li
        v-for="entry in sortedTypeEntries"
        :key="entry.id"
        :class="['wtSetRow', { wtSetRowActive: activeEntryId === entry.id }]"
        role="button"
        tabindex="0"
        :aria-expanded="activeEntryId === entry.id"
        :aria-label="`${formatDateShort(entry.date)}: ${displayLen(entry.value)} ${lengthUnit}`"
        @click="toggleEntryActions(entry.id)"
        @keydown.enter="toggleEntryActions(entry.id)"
        @keydown.space.prevent="toggleEntryActions(entry.id)"
      >
        <span class="wtSetDate">{{ formatDateShort(entry.date) }}</span>
        <span class="wtSetDetail">{{ displayLen(entry.value) }} {{ lengthUnit }}</span>
        <span v-if="entryDelta(entry) != null" class="bwDelta">
          {{ entryDelta(entry)! > 0 ? '+' : '' }}{{ displayLen(entryDelta(entry)!) }}
        </span>
        <div v-if="activeEntryId === entry.id" class="wtSetActions">
          <button class="wtSetBtn" @click.stop="openModal(entry)" aria-label="Edit measurement">Edit</button>
          <button class="wtSetBtn wtSetBtnDel" @click.stop="deleteEntry(entry.id)" aria-label="Delete measurement">Delete</button>
        </div>
      </li>
    </ul>
  </div>

  <!-- Log / Edit Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay" @click.self="closeModal" @keydown.escape="closeModal">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="bm-modal-title">
        <h2 id="bm-modal-title">{{ editing ? `Edit ${selectedLabel}` : `Log ${selectedLabel}` }}</h2>
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
          {{ selectedLabel }} ({{ lengthUnit }})
          <div class="repMaxInputRow">
            <input
              ref="valueInputEl"
              v-model.number="value"
              type="number"
              inputmode="decimal"
              enterkeyhint="done"
              autocomplete="off"
              min="0"
              step="any"
              :placeholder="lengthUnit === 'cm' ? '95' : '37'"
              class="repMaxInput"
              @keydown.enter.prevent="save"
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
import { ref, computed } from 'vue'
import { useBodyMeasurementsStore, MEASUREMENT_TYPES } from '../stores/bodyMeasurements'
import type { MeasurementEntry, MeasurementType } from '../stores/bodyMeasurements'
import { useAnalytics } from '../composables/useAnalytics'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useUndoToast } from '../composables/useUndoToast'
import { useModal } from '../composables/useModal'
import { useSVGTimeSeries, type TimeSeriesEntry } from '../composables/useSVGTimeSeries'

const store = useBodyMeasurementsStore()
const { weightUnit } = useWeightUnit()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()

// ── Units ────────────────────────────────────────────────────────
// Values are stored canonically in centimeters. Imperial users (lbs) see
// inches; metric users (kg) see centimeters.
const lengthUnit = computed(() => (weightUnit.value === 'kg' ? 'cm' : 'in'))
const CM_PER_INCH = 2.54
function displayLen(cm: number): number {
  if (weightUnit.value === 'kg') return +cm.toFixed(1)
  return +(cm / CM_PER_INCH).toFixed(1)
}
function toCm(value: number): number {
  if (weightUnit.value === 'kg') return +value.toFixed(1)
  return +(value * CM_PER_INCH).toFixed(1)
}

// ── Type selector ────────────────────────────────────────────────
const TYPES: { id: MeasurementType; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'arms', label: 'Arms' },
  { id: 'waist', label: 'Waist' },
  { id: 'thighs', label: 'Thighs' },
]
const selectedType = ref<MeasurementType>(MEASUREMENT_TYPES[0])
const selectedLabel = computed(() => TYPES.find(t => t.id === selectedType.value)?.label ?? '')

function selectType(t: MeasurementType) {
  selectedType.value = t
  activeEntryId.value = null
}

// ── Entries for the selected type ────────────────────────────────
const typeEntries = computed(() => store.entriesForType(selectedType.value))
const sortedTypeEntries = computed(() =>
  [...typeEntries.value].sort((a, b) => b.date.localeCompare(a.date))
)
const latest = computed(() => store.latestForType(selectedType.value))

const latestDelta = computed((): number | null => {
  const sorted = sortedTypeEntries.value
  if (sorted.length < 2) return null
  return +(sorted[0].value - sorted[1].value).toFixed(1)
})

function entryDelta(entry: MeasurementEntry): number | null {
  const sorted = sortedTypeEntries.value
  const idx = sorted.indexOf(entry)
  if (idx < 0 || idx >= sorted.length - 1) return null
  return +(entry.value - sorted[idx + 1].value).toFixed(1)
}

// ── Modal state ──────────────────────────────────────────────────
const valueInputEl = ref<HTMLInputElement | null>(null)
const { isOpen: showModal, open: openModalTrap, close: closeModalTrap } = useModal({
  selector: '[aria-labelledby="bm-modal-title"]',
  onOpen: () => valueInputEl.value?.focus(),
})
const editing = ref<string | null>(null)
const value = ref<number | null>(null)
const date = ref(todayISO())

const dateDisplay = computed(() =>
  new Date(date.value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
)

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

function openModal(entry: MeasurementEntry | null = null) {
  if (entry) {
    editing.value = entry.id
    value.value = displayLen(entry.value)
    date.value = isoToLocalDate(entry.date)
  } else {
    editing.value = null
    value.value = null
    date.value = todayISO()
  }
  openModalTrap()
}

function closeModal() {
  closeModalTrap()
  editing.value = null
  value.value = null
  date.value = todayISO()
}

const canSave = computed(() => value.value !== null && value.value > 0)

function save() {
  if (!canSave.value || value.value === null) return
  if (editing.value) {
    store.updateEntry(editing.value, toCm(value.value), date.value)
    logEvent('body_measurement_edit', { type: selectedType.value })
  } else {
    store.addEntry(selectedType.value, toCm(value.value), date.value)
    logEvent('body_measurement_add', { type: selectedType.value })
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
  logEvent('body_measurement_delete', { type: saved.type })
  showUndo(
    'Measurement deleted',
    () => store.restoreEntry(saved),
    () => store.syncDeleteEntry(id),
  )
}

// ── Period + chart ───────────────────────────────────────────────
const PERIODS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y',  days: 365 },
  { label: 'All', days: 36500 },
]
const period = ref(90)

// Latest value per calendar date for the selected type, chronological
const dailyLatest = computed(() => {
  const byDate: Record<string, MeasurementEntry> = {}
  for (const e of typeEntries.value) {
    const day = e.date.slice(0, 10)
    if (!byDate[day] || e.id > byDate[day].id) byDate[day] = e
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, e]) => ({ date: d, value: e.value }))
})

const filteredDaily = computed(() => {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - period.value)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return dailyLatest.value.filter(d => d.date >= cutoffStr)
})

const graphEntries = computed((): TimeSeriesEntry[] =>
  filteredDaily.value.map(d => ({ date: d.date, value: d.value }))
)

const {
  W, H, PAD_L, PAD_R, PAD_T, chartH,
  minVal, maxVal,
  points,
  linePoints, gridYs,
  shouldShowLabel, formatDate,
} = useSVGTimeSeries(graphEntries)

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.bmCard {
  margin-top: 16px;
}
.bmHeader {
  margin-bottom: 12px;
}
.bmTitle {
  margin: 0;
}
.bmTypeRow {
  margin-bottom: 12px;
}
</style>
