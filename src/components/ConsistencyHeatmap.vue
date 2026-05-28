<template>
  <div class="heatmapCard">
    <!-- Streak stats banner -->
    <div class="heatmapStats">
      <div class="heatmapStat">
        <span class="heatmapStatValue">{{ currentStreak }}</span>
        <span class="heatmapStatLabel">{{ currentStreak === 1 ? 'week' : 'weeks' }} current</span>
      </div>
      <span class="heatmapStatDivider"></span>
      <div class="heatmapStat">
        <span class="heatmapStatValue">{{ longestStreak }}</span>
        <span class="heatmapStatLabel">{{ longestStreak === 1 ? 'week' : 'weeks' }} longest</span>
      </div>
      <span class="heatmapStatDivider"></span>
      <div class="heatmapStat">
        <span class="heatmapStatValue">{{ totalWorkoutDays }}</span>
        <span class="heatmapStatLabel">{{ totalWorkoutDays === 1 ? 'day' : 'days' }} total</span>
      </div>
    </div>

    <!-- Year navigation -->
    <div class="heatmapNav">
      <button class="calNavBtn" @click="$emit('prev-year')" aria-label="Previous year">‹</button>
      <span class="heatmapNavLabel">{{ year }}</span>
      <button class="calNavBtn" @click="$emit('next-year')" :disabled="isCurrentYear" aria-label="Next year">›</button>
    </div>

    <!-- Heatmap grid -->
    <div class="heatmapContainer">
      <!-- Day labels (Mon, Wed, Fri) -->
      <div class="heatmapDayLabels">
        <span class="heatmapDayLabel"></span>
        <span class="heatmapDayLabel">Mon</span>
        <span class="heatmapDayLabel"></span>
        <span class="heatmapDayLabel">Wed</span>
        <span class="heatmapDayLabel"></span>
        <span class="heatmapDayLabel">Fri</span>
        <span class="heatmapDayLabel"></span>
      </div>
      <div class="heatmapScrollArea" ref="scrollArea">
        <!-- Month labels -->
        <div class="heatmapMonthRow">
          <span
            v-for="m in monthLabels"
            :key="m.label + m.offset"
            class="heatmapMonthLabel"
            :style="{ gridColumn: m.col }"
          >{{ m.label }}</span>
        </div>
        <!-- Grid of cells: 7 rows × N columns -->
        <div
          class="heatmapGrid"
          :style="{ gridTemplateColumns: `repeat(${totalWeeks}, 12px)` }"
          role="img"
          :aria-label="`Workout consistency heatmap for ${year}`"
        >
          <template v-for="(cell, i) in cells" :key="i">
            <div
              v-if="cell"
              :class="['heatmapCell', `heatmapL${cell.level}`]"
              :style="{ gridRow: cell.row, gridColumn: cell.col }"
              :title="cell.tooltip"
              :aria-label="cell.tooltip"
            ></div>
          </template>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="heatmapLegend">
      <span class="heatmapLegendLabel">Less</span>
      <span class="heatmapCell heatmapL0"></span>
      <span class="heatmapCell heatmapL1"></span>
      <span class="heatmapCell heatmapL2"></span>
      <span class="heatmapCell heatmapL3"></span>
      <span class="heatmapCell heatmapL4"></span>
      <span class="heatmapLegendLabel">More</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'

export interface HeatmapDay {
  date: string   // YYYY-MM-DD
  sets: number
}

const props = defineProps<{
  year: number
  days: HeatmapDay[]
  currentStreak: number
  longestStreak: number
  isCurrentYear: boolean
}>()

defineEmits<{
  'prev-year': []
  'next-year': []
}>()

const scrollArea = ref<HTMLElement | null>(null)

// Scroll to end (current date) when viewing current year
watch(() => props.year, async () => {
  await nextTick()
  if (props.isCurrentYear && scrollArea.value) {
    scrollArea.value.scrollLeft = scrollArea.value.scrollWidth
  }
}, { immediate: true })

// Build a lookup: dateStr → sets
const dayMap = computed(() => {
  const m = new Map<string, number>()
  for (const d of props.days) {
    m.set(d.date, d.sets)
  }
  return m
})

const totalWorkoutDays = computed(() => {
  let count = 0
  for (const d of props.days) {
    if (d.sets > 0) count++
  }
  return count
})

// Compute intensity thresholds based on the data distribution
const thresholds = computed(() => {
  const counts = props.days.map(d => d.sets).filter(n => n > 0).sort((a, b) => a - b)
  if (counts.length === 0) return [1, 2, 3, 4]
  const p25 = counts[Math.floor(counts.length * 0.25)] || 1
  const p50 = counts[Math.floor(counts.length * 0.50)] || 2
  const p75 = counts[Math.floor(counts.length * 0.75)] || 3
  return [
    Math.max(1, p25),
    Math.max(p25 + 1, p50),
    Math.max(p50 + 1, p75),
    Math.max(p75 + 1, p75 + 1),
  ]
})

function getLevel(sets: number): number {
  if (sets === 0) return 0
  const [t1, t2, t3, t4] = thresholds.value
  if (sets < t1) return 1
  if (sets < t2) return 2
  if (sets < t3) return 3
  if (sets >= t4) return 4
  return 3
}

// Jan 1 of the year
const jan1 = computed(() => new Date(props.year, 0, 1))
const jan1Dow = computed(() => jan1.value.getDay()) // 0=Sun

// Dec 31 of the year
const dec31 = computed(() => new Date(props.year, 11, 31))

// Total weeks in the grid (columns)
const totalWeeks = computed(() => {
  const dayOfYear = Math.floor((dec31.value.getTime() - jan1.value.getTime()) / 86400000) + 1
  return Math.ceil((dayOfYear + jan1Dow.value) / 7)
})

// Build cells: one per day of the year
const cells = computed(() => {
  const result: Array<{ row: number; col: number; level: number; tooltip: string }> = []
  const startDow = jan1Dow.value
  const isLeap = (props.year % 4 === 0 && props.year % 100 !== 0) || props.year % 400 === 0
  const daysInYear = isLeap ? 366 : 365

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  for (let dayIdx = 0; dayIdx < daysInYear; dayIdx++) {
    const d = new Date(props.year, 0, 1 + dayIdx)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    // Skip future dates
    if (dateStr > todayStr) break

    const dow = (startDow + dayIdx) % 7  // 0=Sun, 6=Sat
    const col = Math.floor((dayIdx + startDow) / 7) + 1  // 1-indexed for CSS grid
    const row = dow + 1  // 1-indexed for CSS grid

    const sets = dayMap.value.get(dateStr) || 0
    const level = getLevel(sets)

    const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const tooltip = sets > 0
      ? `${dateLabel}: ${sets} set${sets !== 1 ? 's' : ''}`
      : `${dateLabel}: Rest day`

    result.push({ row, col, level, tooltip })
  }
  return result
})

// Month labels positioned at the first week of each month
const monthLabels = computed(() => {
  const labels: Array<{ label: string; col: number; offset: number }> = []
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(props.year, m, 1)
    const dayOfYear = Math.floor((firstOfMonth.getTime() - jan1.value.getTime()) / 86400000)
    const col = Math.floor((dayOfYear + jan1Dow.value) / 7) + 1
    labels.push({ label: MONTHS[m], col, offset: m })
  }
  return labels
})
</script>
