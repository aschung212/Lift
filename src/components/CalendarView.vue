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
      <button class="calNavBtn" @click="prev">‹</button>
      <span class="calNavLabel">{{ navLabel }}</span>
      <button class="calNavBtn" @click="next">›</button>
    </div>

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
          @click="cell.inMonth && cell.exercises.length > 0 && toggleDay(cell.dateStr)"
        >
          <span class="calCellNum">{{ cell.day }}</span>
          <div v-if="cell.exercises.length > 0 && cell.inMonth" class="calDots">
            <span
              v-for="(ex, i) in cell.exercises.slice(0, 3)"
              :key="i"
              class="calDot"
              :style="{ background: exerciseColor(ex) }"
            ></span>
            <span v-if="cell.exercises.length > 3" class="calOverflow">+{{ cell.exercises.length - 3 }}</span>
          </div>
        </div>
      </div>

      <!-- Selected day detail -->
      <div v-if="selectedDay && trainingMap[selectedDay]" class="calDetail">
        <p class="calDetailDate">{{ formatSelectedDay(selectedDay) }}</p>
        <div class="calDetailTags">
          <span
            v-for="ex in trainingMap[selectedDay]"
            :key="ex"
            class="calDetailTag"
            :style="{ borderColor: exerciseColor(ex), color: exerciseColor(ex) }"
          >{{ ex }}</span>
        </div>
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
          <span
            v-for="ex in day.exercises"
            :key="ex"
            class="calWeekTag"
            :style="{ borderColor: exerciseColor(ex), color: exerciseColor(ex) }"
          >{{ ex }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useWorkoutStore } from '../stores/workout'

const store = useWorkoutStore()

const EXERCISE_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#34d399', '#38bdf8', '#818cf8', '#e879f9',
]

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const view = ref('month')
const cursor = ref(new Date())
const selectedDay = ref(null)

function setView(v) {
  view.value = v
  selectedDay.value = null
}

function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayStr = toLocalDateStr(new Date())

// Map YYYY-MM-DD → unique exercise names
const trainingMap = computed(() => {
  const map = {}
  for (const exercise of store.exercises) {
    for (const set of exercise.sets) {
      const day = set.date.slice(0, 10)
      if (!map[day]) map[day] = []
      if (!map[day].includes(exercise.name)) map[day].push(exercise.name)
    }
  }
  return map
})

function exerciseColor(name) {
  const idx = store.exercises.findIndex(e => e.name === name)
  return EXERCISE_COLORS[Math.max(0, idx) % EXERCISE_COLORS.length]
}

// Navigation label
const navLabel = computed(() => {
  if (view.value === 'month') {
    return cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const days = weekDays.value
  const first = new Date(days[0].dateStr + 'T12:00:00')
  const last = new Date(days[6].dateStr + 'T12:00:00')
  const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

function toggleDay(dateStr) {
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

function formatSelectedDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  })
}
</script>
