<template>
  <div class="calCard">
    <!-- Header -->
    <div class="calCardHeader">
      <h2 class="calTitle">Training Calendar</h2>
      <div class="calViewToggle">
        <button :class="['calToggleBtn', { active: view === 'month' }]" :aria-pressed="view === 'month'" @click="setView('month')">Month</button>
        <button :class="['calToggleBtn', { active: view === 'week' }]" :aria-pressed="view === 'week'" @click="setView('week')">Week</button>
      </div>
    </div>

    <!-- Navigation -->
    <div class="calNav">
      <button class="calNavBtn" @click="prev" aria-label="Previous">‹</button>
      <button :class="['calNavLabel', { calNavLabelTappable: !isCurrentPeriod }]" :disabled="isCurrentPeriod" @click="goToToday">{{ navLabel }}</button>
      <button class="calNavBtn" @click="next" aria-label="Next">›</button>
    </div>

    <!-- Tag filter -->
    <template v-if="store.allTags.length > 0">
      <div class="wtTagFilterBar">
        <button
          v-for="tag in store.allTags"
          :key="tag"
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
          :aria-pressed="activeTagFilters.includes(tag) ? 'true' : 'false'"
          :aria-label="activeTagFilters.includes(tag) ? `Remove ${tag} filter` : `Filter by ${tag}`"
          @click="toggleTagFilter(tag)"
        >{{ tag }}</button>
        <button
          v-if="activeTagFilters.length > 0"
          class="wtTagChip wtTagChipClear"
          aria-label="Clear all tag filters"
          @click="activeTagFilters = []"
        >× Clear</button>
      </div>
    </template>

    <!-- Monthly view -->
    <template v-if="view === 'month'">
      <div class="calGrid">
        <div v-for="d in DAY_HEADERS" :key="d" class="calDayHeader">{{ d }}</div>
        <div
          v-for="cell in monthCells"
          :key="cell.key"
          class="calCell"
          :class="{
            calCellToday: cell.isToday,
            calCellOtherMonth: !cell.inMonth,
            calCellHasWork: cell.exercises.length > 0 && cell.inMonth,
            calCellSelected: selectedDay === cell.dateStr && cell.inMonth
          }"
          :role="cell.inMonth ? 'button' : undefined"
          :tabindex="cell.inMonth ? 0 : -1"
          :aria-label="cell.inMonth ? cellAriaLabel(cell) : undefined"
          :aria-pressed="cell.inMonth ? selectedDay === cell.dateStr : undefined"
          @click="cell.inMonth && toggleDay(cell.dateStr)"
          @keydown.enter.prevent="cell.inMonth && toggleDay(cell.dateStr)"
          @keydown.space.prevent="cell.inMonth && toggleDay(cell.dateStr)"
        >
          <span class="calCellNum">{{ cell.day }}</span>
          <span v-if="cell.inMonth && hasPR(cell.dateStr)" class="calCellPR">🏆</span>
          <div v-if="cell.exercises.length > 0 && cell.inMonth" class="calDots">
            <span
              v-for="(_ex, i) in cell.exercises.slice(0, 3)"
              :key="i"
              class="calDot"
            ></span>
            <span v-if="cell.exercises.length > 3" class="calOverflow">+{{ cell.exercises.length - 3 }}</span>
          </div>
        </div>
      </div>

      <!-- First-use empty state (no workout data at all) -->
      <p v-if="!hasAnyData && !selectedDay" class="wtEmpty calEmptyState">
        Log your first workout on the Workouts tab to see it here.
      </p>

      <!-- Selected day detail -->
      <div v-if="selectedDay" class="calDetail">
        <div class="calDetailHeader">
          <p class="calDetailDate">{{ formatSelectedDay(selectedDay) }}</p>
          <button class="calLogBtn" @click="openLogModal(selectedDay)">+ Log</button>
        </div>
        <div v-if="trainingMap[selectedDay]" class="calDetailTags">
          <!-- Daily workout summary -->
          <div class="calSummaryBar" v-if="daySummary">
            <span class="calSumStat">
              <span class="calSumValue">{{ daySummary.exercises }}</span>
              <span class="calSumLabel">exercise{{ daySummary.exercises !== 1 ? 's' : '' }}</span>
            </span>
            <span class="calSumDivider"></span>
            <span class="calSumStat">
              <span class="calSumValue">{{ daySummary.sets }}</span>
              <span class="calSumLabel">set{{ daySummary.sets !== 1 ? 's' : '' }}</span>
            </span>
            <span class="calSumDivider"></span>
            <span class="calSumStat">
              <span class="calSumValue">{{ daySummary.volumeDisplay }}</span>
              <span class="calSumLabel">{{ weightUnit }} volume</span>
            </span>
            <span v-if="daySummary.prs > 0" class="calSumDivider"></span>
            <span v-if="daySummary.prs > 0" class="calSumStat calSumPR">
              <span class="calSumValue">🏆 {{ daySummary.prs }}</span>
              <span class="calSumLabel">PR{{ daySummary.prs !== 1 ? 's' : '' }}</span>
            </span>
          </div>

          <div class="calExList">
            <div v-for="ex in trainingMap[selectedDay]" :key="ex" class="calExGroup">
              <button
                :class="['calExRow', { calExRowExpanded: expandedExercises.has(`${selectedDay}::${ex}`), calExRowPR: isPRExercise(selectedDay, ex) }]"
                :aria-expanded="expandedExercises.has(`${selectedDay}::${ex}`)"
                @click="toggleDetail(selectedDay, ex)"
              >
                <span class="calExRowLeft">
                  <span v-if="isPRExercise(selectedDay, ex)" class="calSetPR">🏆</span>
                  <span class="calExRowName">{{ ex }}</span>
                </span>
                <span class="calExRowRight">
                  <span class="calExRowCount">{{ getSetCount(selectedDay, ex) }} set{{ getSetCount(selectedDay, ex) !== 1 ? 's' : '' }}</span>
                  <span :class="['calExRowChevron', { calExRowChevronOpen: expandedExercises.has(`${selectedDay}::${ex}`) }]">›</span>
                </span>
              </button>
              <div v-if="expandedExercises.has(`${selectedDay}::${ex}`)" class="calSetList">
                <div
                  v-for="s in getSetsForDay(selectedDay, ex)"
                  :key="s.id"
                  :class="['calSetRow', { calSetRowPR: s.isPR }]"
                >
                  <span class="calSetMain">
                    <span v-if="s.isPR" class="calSetPR">🏆</span>
                    <span class="calSetWeight">{{ displayWeight(s.weight) }} {{ weightUnit }}</span>
                    <span class="calSetSep">×</span>
                    <span class="calSetReps">{{ s.reps }} reps</span>
                  </span>
                  <span class="calSetE1RM">~{{ displayWeight(Math.round(s.estimated1RM)) }} {{ weightUnit }} e1RM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="calDetailEmpty">No sets logged.</p>
      </div>
    </template>

    <!-- Weekly view -->
    <div v-else class="calWeek">
      <div
        v-for="day in weekDays"
        :key="day.dateStr"
        class="calWeekRow"
        :class="{ calWeekRowToday: day.isToday }"
      >
        <div class="calWeekDayCol">
          <span class="calWeekDayName">{{ day.shortName }}</span>
          <span class="calWeekDayNum" :class="{ calWeekDayNumToday: day.isToday }">{{ day.dayNum }}</span>
          <button class="calWeekDayLogBtn" :aria-label="`Log workout for ${day.shortName} ${day.dayNum}`" @click="openLogModal(day.dateStr)">+</button>
        </div>
        <div class="calWeekContent">
          <span v-if="day.exercises.length === 0" class="calWeekRest">Rest</span>
          <div v-if="day.exercises.length > 0" class="calExList">
            <div v-for="ex in day.exercises" :key="ex" class="calExGroup">
              <button
                :class="['calExRow calExRowCompact', { calExRowExpanded: expandedExercises.has(`${day.dateStr}::${ex}`), calExRowPR: isPRExercise(day.dateStr, ex) }]"
                :aria-expanded="expandedExercises.has(`${day.dateStr}::${ex}`)"
                @click="toggleDetail(day.dateStr, ex)"
              >
                <span class="calExRowLeft">
                  <span v-if="isPRExercise(day.dateStr, ex)" class="calSetPR">🏆</span>
                  <span class="calExRowName">{{ ex }}</span>
                </span>
                <span class="calExRowRight">
                  <span class="calExRowCount">{{ getSetCount(day.dateStr, ex) }}</span>
                  <span :class="['calExRowChevron', { calExRowChevronOpen: expandedExercises.has(`${day.dateStr}::${ex}`) }]">›</span>
                </span>
              </button>
              <div v-if="expandedExercises.has(`${day.dateStr}::${ex}`)" class="calSetList">
                <div
                  v-for="s in getSetsForDay(day.dateStr, ex)"
                  :key="s.id"
                  :class="['calSetRow', { calSetRowPR: s.isPR }]"
                >
                  <span class="calSetMain">
                    <span v-if="s.isPR" class="calSetPR">🏆</span>
                    <span class="calSetWeight">{{ displayWeight(s.weight) }} {{ weightUnit }}</span>
                    <span class="calSetSep">×</span>
                    <span class="calSetReps">{{ s.reps }} reps</span>
                  </span>
                  <span class="calSetE1RM">~{{ displayWeight(Math.round(s.estimated1RM)) }} {{ weightUnit }} e1RM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- First-use empty state (no workout data at all) -->
      <p v-if="!hasAnyData" class="wtEmpty calEmptyState">
        Log your first workout on the Workouts tab to see it here.
      </p>

      <MuscleGroupRecovery
        v-if="hasRecoveryData"
        :recovery="tagRecovery"
        :hidden-count="recoveryHiddenCount"
        :hidden-tags="recoveryHiddenTags"
        @hide="onRecoveryHide"
        @show="onRecoveryShow"
        @days-change="onRecoveryDaysChange"
      />

      <!-- Weekly muscle group volume chart (collapsible) -->
      <MuscleGroupChart
        v-if="weeklyVolume.length > 0"
        :weekly-volume="weeklyVolume"
        :max-sets="maxSets"
        :total-sets="totalSets"
        :tag-trends="tagTrends"
        :collapsed="volumeCollapsed"
        @toggle-collapsed="volumeCollapsed = !volumeCollapsed"
      />

      <!-- Week-over-week training volume trend (collapsible) -->
      <VolumeTrendChart
        v-if="volumeTrend.length >= 2"
        :weekly-volume="volumeTrend"
        :total-volume="volumeTrendTotal"
        :collapsed="trendCollapsed"
        @toggle-collapsed="trendCollapsed = !trendCollapsed"
      />

      <!-- Rep-range / intensity-zone distribution (collapsible) -->
      <RepRangeChart
        v-if="repRangeTotal > 0"
        :zones="repRangeZones"
        :total-sets="repRangeTotal"
        :dominant="repRangeDominant"
        :collapsed="repRangeCollapsed"
        @toggle-collapsed="repRangeCollapsed = !repRangeCollapsed"
      />
    </div>
  </div>

  <!-- Exercise Picker Modal -->
  <Teleport to="body">
    <div v-if="pickerOpen" class="repMaxOverlay" @click.self="closeExercisePicker" @keydown.escape="closeExercisePicker">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="exercise-picker-title">
        <h2 id="exercise-picker-title">Choose Exercise</h2>
        <div class="wtExPickerList">
          <button
            v-for="ex in store.exercises"
            :key="ex.id"
            class="wtExPickerRow"
            @click="pickExercise(ex.id)"
          >
            <span class="wtExPickerName">{{ ex.name }}</span>
            <span class="wtChevron">›</span>
          </button>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="closeExercisePicker">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Log Set Modal -->
  <Teleport to="body">
    <div v-if="logModalOpen" class="repMaxOverlay" @click.self="closeLogModal" @keydown.escape="closeLogModal">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="cal-modal-title">
        <h2 id="cal-modal-title">{{ store.exercises.find(e => e.id === logModal.exerciseId)?.name || 'Log a Set' }}</h2>
        <p class="wtModalSubtitle">{{ formatSelectedDay(logModal.date) }}</p>

        <div class="wtInputRow">
          <label class="repMaxLabel" style="flex:1">
            Weight ({{ weightUnit }})
            <div class="repMaxInputRow">
              <input
                v-model.number="logModal.weight"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                placeholder="135"
                class="repMaxInput"
              />
            </div>
          </label>
          <label class="repMaxLabel" style="flex:1">
            Reps
            <div class="repMaxInputRow">
              <input
                v-model.number="logModal.reps"
                type="number"
                inputmode="numeric"
                min="1"
                max="30"
                placeholder="8"
                class="repMaxInput"
              />
            </div>
          </label>
        </div>

        <div v-if="logModalEstimate" class="repMaxResult">
          <span class="repMaxResultLabel">Estimated 1RM</span>
          <span class="repMaxResultValue">{{ logModalEstimate }} {{ weightUnit }}</span>
        </div>

        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!canSaveLog" @click="saveLog">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="closeLogModal">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { localDateKey, todayISO } from '../lib/dates'
import { useAnalytics } from '../composables/useAnalytics'
import { useWeightUnit } from '../composables/useWeightUnit'
import { usePRBaseline } from '../composables/usePRBaseline'
import { useModal } from '../composables/useModal'
import { useTagVolume } from '../composables/useTagVolume'
import { useTagVolumeTrend } from '../composables/useTagVolumeTrend'
import { useTagRecovery } from '../composables/useTagRecovery'
import { useVolumeTrend } from '../composables/useVolumeTrend'
import { useRepRangeDistribution } from '../composables/useRepRangeDistribution'
import { useCalendarData } from '../composables/useCalendarData'

const MuscleGroupChart = defineAsyncComponent(() => import('../components/MuscleGroupChart.vue'))
const MuscleGroupRecovery = defineAsyncComponent(() => import('../components/MuscleGroupRecovery.vue'))
const VolumeTrendChart = defineAsyncComponent(() => import('../components/VolumeTrendChart.vue'))
const RepRangeChart = defineAsyncComponent(() => import('../components/RepRangeChart.vue'))

const store = useWorkoutStore()
const { weightUnit, displayWeight, toLbs } = useWeightUnit()
const { prBaselineDate } = usePRBaseline()
const { logEvent } = useAnalytics()

// ── Tag filtering ────────────────────────────────────────────────
const activeTagFilters = ref<string[]>([])

function toggleTagFilter(tag: string) {
  const idx = activeTagFilters.value.indexOf(tag)
  if (idx >= 0) {
    activeTagFilters.value = activeTagFilters.value.filter(t => t !== tag)
  } else {
    activeTagFilters.value = [...activeTagFilters.value, tag]
  }
}

const filteredExercises = computed(() => {
  if (activeTagFilters.value.length === 0) return store.exercises
  return store.exercises.filter(e => {
    const tags = e.tags || []
    return activeTagFilters.value.some(t => tags.includes(t))
  })
})

// Remove stale tags from active filters
watch(() => store.allTags, (tags) => {
  activeTagFilters.value = activeTagFilters.value.filter(t => tags.includes(t))
})


const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const view = ref('month')
const cursor = ref(new Date())
const selectedDay = ref<string | null>(null)

function setView(v: string) {
  view.value = v
  selectedDay.value = null
  logEvent('calendar_view_switch', { view: v })
}

const todayStr = todayISO()

// True when the user has zero sets across all exercises (brand-new account)
const hasAnyData = computed(() =>
  store.exercises.some(e => e.sets.length > 0)
)

// ── Calendar domain derivation (training map, PR dates, day summary) ──
const {
  trainingMap,
  daySummary,
  isPRExercise,
  hasPR,
  getSetsForDay,
  getSetCount,
} = useCalendarData({
  exercises: filteredExercises,
  selectedDay,
  prBaselineDate,
  getExercisePR: store.getExercisePR,
  displayWeight,
})

// Exercise detail expand: "YYYY-MM-DD::Exercise Name" or null
const expandedExercises = ref(new Set<string>())
watch(selectedDay, () => expandedExercises.value.clear())

function toggleDetail(dateStr: string, exName: string) {
  const key = `${dateStr}::${exName}`
  if (expandedExercises.value.has(key)) {
    expandedExercises.value.delete(key)
  } else {
    expandedExercises.value.add(key)
  }
}

// Navigation label
const navLabel = computed(() => {
  if (view.value === 'month') {
    return cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const days = weekDays.value
  const first = new Date(days[0].dateStr + 'T12:00:00')
  const last = new Date(days[6].dateStr + 'T12:00:00')
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(first)} – ${fmt(last)}`
})

const isCurrentPeriod = computed(() => {
  const now = new Date()
  if (view.value === 'month') {
    return cursor.value.getFullYear() === now.getFullYear() && cursor.value.getMonth() === now.getMonth()
  }
  // Week view: check if today falls within the displayed week
  const days = weekDays.value
  return days.some(d => d.isToday)
})

function goToToday() {
  cursor.value = new Date()
  selectedDay.value = null
}

function prev() {
  const d = new Date(cursor.value)
  if (view.value === 'month') d.setMonth(d.getMonth() - 1)
  else d.setDate(d.getDate() - 7)
  cursor.value = d
  selectedDay.value = null
}

function next() {
  const d = new Date(cursor.value)
  if (view.value === 'month') d.setMonth(d.getMonth() + 1)
  else d.setDate(d.getDate() + 7)
  cursor.value = d
  selectedDay.value = null
}

function toggleDay(dateStr: string) {
  selectedDay.value = selectedDay.value === dateStr ? null : dateStr
}

function cellAriaLabel(cell: { dateStr: string; exercises: string[]; isToday: boolean }): string {
  const date = new Date(cell.dateStr + 'T12:00:00')
  const dateLabel = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const parts = [dateLabel]
  if (cell.isToday) parts.push('today')
  if (cell.exercises.length > 0) {
    parts.push(`${cell.exercises.length} exercise${cell.exercises.length !== 1 ? 's' : ''}`)
  }
  if (hasPR(cell.dateStr)) parts.push('PR')
  if (selectedDay.value === cell.dateStr) parts.push('selected')
  return parts.join(', ')
}

// Monthly grid cells
const monthCells = computed(() => {
  const year = cursor.value.getFullYear()
  const month = cursor.value.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevMonthDays = new Date(year, month, 0).getDate()
  const cells = []

  for (let i = firstDow - 1; i >= 0; i--) {
    const day = prevMonthDays - i
    const d = new Date(year, month - 1, day)
    const dateStr = localDateKey(d)
    cells.push({ key: `p${day}`, day, dateStr, inMonth: false, isToday: dateStr === todayStr, exercises: trainingMap.value[dateStr] || [] })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day)
    const dateStr = localDateKey(d)
    cells.push({ key: `c${day}`, day, dateStr, inMonth: true, isToday: dateStr === todayStr, exercises: trainingMap.value[dateStr] || [] })
  }

  const rem = cells.length % 7
  if (rem > 0) {
    for (let day = 1; day <= 7 - rem; day++) {
      const d = new Date(year, month + 1, day)
      const dateStr = localDateKey(d)
      cells.push({ key: `n${day}`, day, dateStr, inMonth: false, isToday: dateStr === todayStr, exercises: trainingMap.value[dateStr] || [] })
    }
  }

  return cells
})

// Weekly days
const weekDays = computed(() => {
  const d = new Date(cursor.value)
  d.setDate(d.getDate() - d.getDay()) // back to Sunday
  const SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return Array.from({ length: 7 }, (_, i) => {
    const curr = new Date(d)
    curr.setDate(d.getDate() + i)
    const dateStr = localDateKey(curr)
    return {
      dateStr,
      shortName: SHORT_NAMES[i],
      dayNum: curr.getDate(),
      isToday: dateStr === todayStr,
      exercises: trainingMap.value[dateStr] || []
    }
  })
})

// ── Weekly muscle group volume ────────────────────────────────────
const weekDateStrings = computed(() => weekDays.value.map(d => d.dateStr))
const exercisesRef = computed(() => filteredExercises.value)
const { weeklyVolume, maxSets, totalSets } = useTagVolume(exercisesRef, weekDateStrings)
const { tagTrends } = useTagVolumeTrend(exercisesRef)

// ── Week-over-week volume trend (full history, respects tag filter) ──
const { weeklyVolume: volumeTrend, totalVolume: volumeTrendTotal } = useVolumeTrend(exercisesRef)

// ── Rep-range distribution (full history, respects tag filter) ──
const { zones: repRangeZones, totalSets: repRangeTotal, dominant: repRangeDominant } = useRepRangeDistribution(exercisesRef)

// ── Tag recovery ─────────────────────────────────────────────────
const allExercisesRef = computed(() => store.exercises)
const tagRecoveryDaysRef = computed(() => store.tagRecoveryDays)
const tagRecoveryExcludedRef = computed(() => store.tagRecoveryExcluded)
const { recovery: tagRecovery, hasData: hasRecoveryData, hiddenCount: recoveryHiddenCount } = useTagRecovery(allExercisesRef, tagRecoveryDaysRef, tagRecoveryExcludedRef)

const recoveryHiddenTags = computed(() => {
  const tagsWithSets = new Set<string>()
  for (const exercise of store.exercises) {
    if (!exercise.tags || exercise.tags.length === 0) continue
    for (const set of exercise.sets) {
      if (set.date) {
        for (const tag of exercise.tags) {
          tagsWithSets.add(tag)
        }
      }
    }
  }
  return store.tagRecoveryExcluded.filter(t => tagsWithSets.has(t)).sort()
})

function onRecoveryHide(tag: string) {
  store.setTagRecoveryExcluded(tag, true)
}

function onRecoveryShow(tag: string) {
  store.setTagRecoveryExcluded(tag, false)
}

function onRecoveryDaysChange(tag: string, days: number | null) {
  store.setTagRecoveryDays(tag, days)
}

const volumeCollapsed = ref(false)
const trendCollapsed = ref(true)
const repRangeCollapsed = ref(true)

function formatSelectedDay(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  })
}

// ── Log modal ─────────────────────────────────────────────────────
const { isOpen: pickerOpen, open: openPicker, close: closePicker } = useModal({
  selector: '[aria-labelledby="exercise-picker-title"]',
})
// focusContainer: the first field is a number input — focusing the dialog
// (not the field) lets iOS raise the keyboard on the user's first tap instead
// of deadlocking on a pre-focused field (#830).
const { isOpen: logModalOpen, open: openLogTrap, close: closeLogTrap } = useModal({
  selector: '[aria-labelledby="cal-modal-title"]',
  focusContainer: true,
})
const logModal = ref<{ date: string; exerciseId: string; weight: number | null; reps: number | null }>({ date: '', exerciseId: '', weight: null, reps: null })

const exercisePickerDate = ref<string | null>(null)

function openLogModal(dateStr: string) {
  exercisePickerDate.value = dateStr
  openPicker()
}

function pickExercise(exerciseId: string) {
  const dateStr = exercisePickerDate.value!
  exercisePickerDate.value = null
  closePicker()
  logModal.value = { date: dateStr, exerciseId, weight: null, reps: null }
  openLogTrap()
}

function closeLogModal() {
  closeLogTrap()
  logModal.value = { date: '', exerciseId: '', weight: null, reps: null }
}

function closeExercisePicker() {
  exercisePickerDate.value = null
  closePicker()
}

const logModalEstimate = computed(() => {
  const { weight, reps } = logModal.value
  if (!weight || weight <= 0 || !reps || reps < 1) return null
  const w = toLbs(weight)
  const est = reps === 1 ? w : w * (1 + reps / 30)
  return displayWeight(Math.round(est))
})

const canSaveLog = computed(() => {
  const { exerciseId, weight, reps } = logModal.value
  return exerciseId && weight !== null && weight > 0 && reps !== null && reps >= 1
})

function saveLog() {
  if (!canSaveLog.value) return
  const { exerciseId, weight, reps, date } = logModal.value
  if (weight === null || reps === null) return
  store.logSet(exerciseId, toLbs(weight), reps, date)
  logEvent('set_log', { source: 'calendar' })
  closeLogModal()
}
</script>
