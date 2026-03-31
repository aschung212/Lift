<template>
  <div class="calCard">
    <!-- Header -->
    <div class="calCardHeader">
      <h2 class="calTitle">Training Calendar</h2>
      <div class="calViewToggle">
        <button :class="['calToggleBtn', { active: view === 'month' }]" @click="setView('month')">Month</button>
        <button :class="['calToggleBtn', { active: view === 'week' }]" @click="setView('week')">Week</button>
      </div>
    </div>

    <!-- Navigation -->
    <div class="calNav">
      <button class="calNavBtn" @click="prev" aria-label="Previous">‹</button>
      <span class="calNavLabel">{{ navLabel }}</span>
      <button class="calNavBtn" @click="next" aria-label="Next">›</button>
    </div>

    <!-- Tag filter -->
    <template v-if="store.allTags.length > 0">
      <div class="wtTagFilterBar">
        <button
          v-for="tag in store.allTags"
          :key="tag"
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
          @click="toggleTagFilter(tag)"
        >{{ tag }}</button>
        <button
          v-if="activeTagFilters.length > 0"
          class="wtTagChip wtTagChipClear"
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
          @click="cell.inMonth && toggleDay(cell.dateStr)"
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

          <template v-for="ex in trainingMap[selectedDay]" :key="ex">
            <span
              :class="['calDetailTag', { calDetailTagPR: isPRExercise(selectedDay, ex) }]"
              @click="toggleDetail(selectedDay, ex)"
            >{{ isPRExercise(selectedDay, ex) ? '🏆 ' : '' }}{{ ex }} <span class="calTagCount">{{ getSetCount(selectedDay, ex) }}</span></span>
            <div v-if="detailKey === `${selectedDay}::${ex}`" class="calSetList">
              <div
                v-for="s in getSetsForDay(selectedDay, ex)"
                :key="s.id"
                :class="['calSetRow', { calSetRowPR: s.isPR }]"
              >
                <span v-if="s.isPR" class="calSetPR">🏆</span>
                <span>{{ displayWeight(s.weight) }} {{ weightUnit }}</span>
                <span class="calPRDetailSep">×</span>
                <span>{{ s.reps }} reps</span>
                <span class="calPRDetailSep">·</span>
                <span>~{{ displayWeight(Math.round(s.estimated1RM)) }} {{ weightUnit }} e1RM</span>
              </div>
            </div>
          </template>
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
        </div>
        <div class="calWeekContent">
          <span v-if="day.exercises.length === 0" class="calWeekRest">Rest</span>
          <template v-for="ex in day.exercises" :key="ex">

            <span
              :class="['calWeekTag', { calWeekTagPR: isPRExercise(day.dateStr, ex) }]"
              @click="toggleDetail(day.dateStr, ex)"
            >{{ isPRExercise(day.dateStr, ex) ? '🏆 ' : '' }}{{ ex }} <span class="calTagCount">{{ getSetCount(day.dateStr, ex) }}</span></span>
            <div v-if="detailKey === `${day.dateStr}::${ex}`" class="calSetList">
              <div
                v-for="s in getSetsForDay(day.dateStr, ex)"
                :key="s.id"
                :class="['calSetRow', { calSetRowPR: s.isPR }]"
              >
                <span v-if="s.isPR" class="calSetPR">🏆</span>
                <span>{{ displayWeight(s.weight) }} {{ weightUnit }}</span>
                <span class="calPRDetailSep">×</span>
                <span>{{ s.reps }} reps</span>
                <span class="calPRDetailSep">·</span>
                <span>~{{ displayWeight(Math.round(s.estimated1RM)) }} {{ weightUnit }} e1RM</span>
              </div>
            </div>
          </template>
          <button class="calWeekLogBtn" @click="openLogModal(day.dateStr)">+ Log</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Log Set Modal -->
  <Teleport to="body">
    <div v-if="logModal.open" class="repMaxOverlay" @click.self="closeLogModal" @keydown.escape="closeLogModal">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="cal-modal-title">
        <h2 id="cal-modal-title">Log a Set</h2>
        <p class="wtModalSubtitle">{{ formatSelectedDay(logModal.date) }}</p>

        <label class="repMaxLabel">
          Exercise
          <select v-model="logModal.exerciseId" class="repMaxInput">
            <option value="" disabled>Select exercise...</option>
            <option v-for="ex in store.exercises" :key="ex.id" :value="ex.id">{{ ex.name }}</option>
          </select>
        </label>

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
import { ref, computed, watch } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'

const store = useWorkoutStore()
const { weightUnit, displayWeight, toLbs } = useTheme()
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

function toLocalDateStr(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayStr = toLocalDateStr(new Date())

// Map YYYY-MM-DD → unique exercise names (respects tag filter)
const trainingMap = computed(() => {
  const map: Record<string, string[]> = {}
  for (const exercise of filteredExercises.value) {
    for (const set of exercise.sets) {
      const day = set.date.slice(0, 10)
      if (!map[day]) map[day] = []
      if (!map[day].includes(exercise.name)) map[day].push(exercise.name)
    }
  }
  return map
})

// Map YYYY-MM-DD → Set of exercise names that achieved an all-time PR on that date
const prMap = computed(() => {
  const map: Record<string, Set<string>> = {}
  for (const exercise of filteredExercises.value) {
    const pr = store.getExercisePR(exercise.id)
    if (!pr) continue
    for (const set of exercise.sets) {
      if (set.estimated1RM === pr) {
        const day = set.date.slice(0, 10)
        if (!map[day]) map[day] = new Set()
        map[day].add(exercise.name)
      }
    }
  }
  return map
})

function isPRExercise(dateStr: string, exName: string) {
  return prMap.value[dateStr]?.has(exName) ?? false
}

function hasPR(dateStr: string) {
  return !!(prMap.value[dateStr]?.size > 0)
}

// ── Daily workout summary ────────────────────────────────────────
const daySummary = computed(() => {
  if (!selectedDay.value || !trainingMap.value[selectedDay.value]) return null
  const dayStr = selectedDay.value.slice(0, 10)
  let totalSets = 0
  let totalVolume = 0
  let exerciseCount = 0
  let prCount = 0

  for (const exercise of filteredExercises.value) {
    const daySets = exercise.sets.filter(s => s.date.slice(0, 10) === dayStr)
    if (daySets.length === 0) continue
    exerciseCount++
    totalSets += daySets.length
    for (const s of daySets) {
      totalVolume += s.weight * s.reps
    }
    const pr = store.getExercisePR(exercise.id)
    if (pr && daySets.some(s => s.estimated1RM === pr)) {
      prCount++
    }
  }

  const formatted = totalVolume >= 10000
    ? `${(displayWeight(totalVolume) / 1000).toFixed(1)}k`
    : String(displayWeight(totalVolume))

  return {
    exercises: exerciseCount,
    sets: totalSets,
    volumeDisplay: formatted,
    prs: prCount,
  }
})

// Exercise detail expand: "YYYY-MM-DD::Exercise Name" or null
const detailKey = ref<string | null>(null)

function toggleDetail(dateStr: string, exName: string) {
  const key = `${dateStr}::${exName}`
  detailKey.value = detailKey.value === key ? null : key
}

function getSetsForDay(dateStr: string, exName: string) {
  const exercise = store.exercises.find(e => e.name === exName)
  if (!exercise) return []
  const pr = store.getExercisePR(exercise.id)
  const dayStr = dateStr.slice(0, 10)
  return exercise.sets
    .filter(s => s.date.slice(0, 10) === dayStr)
    .sort((a, b) => b.estimated1RM - a.estimated1RM)
    .map(s => ({ ...s, isPR: s.estimated1RM === pr }))
}

function getSetCount(dateStr: string, exName: string) {
  const exercise = store.exercises.find(e => e.name === exName)
  if (!exercise) return 0
  const dayStr = dateStr.slice(0, 10)
  return exercise.sets.filter(s => s.date.slice(0, 10) === dayStr).length
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
    const dateStr = toLocalDateStr(d)
    cells.push({ key: `p${day}`, day, dateStr, inMonth: false, isToday: dateStr === todayStr, exercises: trainingMap.value[dateStr] || [] })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day)
    const dateStr = toLocalDateStr(d)
    cells.push({ key: `c${day}`, day, dateStr, inMonth: true, isToday: dateStr === todayStr, exercises: trainingMap.value[dateStr] || [] })
  }

  const rem = cells.length % 7
  if (rem > 0) {
    for (let day = 1; day <= 7 - rem; day++) {
      const d = new Date(year, month + 1, day)
      const dateStr = toLocalDateStr(d)
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
    const dateStr = toLocalDateStr(curr)
    return {
      dateStr,
      shortName: SHORT_NAMES[i],
      dayNum: curr.getDate(),
      isToday: dateStr === todayStr,
      exercises: trainingMap.value[dateStr] || []
    }
  })
})

function formatSelectedDay(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  })
}

// ── Log modal ─────────────────────────────────────────────────────
const logModal = ref<{ open: boolean; date: string; exerciseId: string; weight: number | null; reps: number | null }>({ open: false, date: '', exerciseId: '', weight: null, reps: null })

function openLogModal(dateStr: string) {
  logModal.value = { open: true, date: dateStr, exerciseId: '', weight: null, reps: null }
}

function closeLogModal() {
  logModal.value = { open: false, date: '', exerciseId: '', weight: null, reps: null }
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
