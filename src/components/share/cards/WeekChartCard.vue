<template>
  <div class="wcRoot">
    <div class="wcHead">
      <div class="wcEyebrow">Week {{ weekdayLabel }}</div>
      <div class="wcBrand">LIFT</div>
    </div>

    <div class="wcDelta">{{ deltaLabel }}</div>
    <div class="wcDeltaCaption">vs last week</div>

    <div class="wcChart">
      <div
        v-for="(v, i) in summary.weekVolume"
        :key="i"
        class="wcCol"
      >
        <span v-if="v" class="wcVal" :class="{ wcValToday: i === todayIdx }">
          {{ (v / 1000).toFixed(1) }}K
        </span>
        <span v-else class="wcValSpacer"></span>
        <div
          class="wcBar"
          :class="{ wcBarToday: i === todayIdx, wcBarMissing: !v }"
          :style="{ height: barPercent(v) + '%' }"
        ></div>
        <span class="wcDay" :class="{ wcDayToday: i === todayIdx }">{{ DAY_LABELS[i] }}</span>
      </div>
    </div>

    <div class="wcFoot">
      <div>
        <div class="wcFootKey">This week</div>
        <div class="wcFootVal">{{ formattedThisWeek }} {{ summary.unitLabel }}</div>
      </div>
      <div class="wcFootRight">
        <div class="wcFootKey">Streak</div>
        <div class="wcFootVal wcFootValAccent">🔥 {{ summary.streak }}wk</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'

const props = defineProps<{ summary: SessionSummary }>()

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const todayIdx = computed(() => {
  // weekRange is Mon→Sun; today's index in that ordering.
  const [y, m, d] = props.summary.rawDate.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
})

const weekdayLabel = computed(() => props.summary.date.split(',')[0])

const thisWeekTotal = computed(() => props.summary.weekVolume.reduce((s, v) => s + v, 0))
const formattedThisWeek = computed(() => Math.round(thisWeekTotal.value).toLocaleString('en-US'))

const deltaLabel = computed(() => {
  if (props.summary.priorWeekVolume === 0) {
    return thisWeekTotal.value === 0 ? '0%' : 'NEW'
  }
  const pct = ((thisWeekTotal.value - props.summary.priorWeekVolume) / props.summary.priorWeekVolume) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${Math.round(pct)}%`
})

const maxVal = computed(() => Math.max(1, ...props.summary.weekVolume))
function barPercent(v: number): number {
  if (v <= 0) return 4
  return Math.max(6, (v / maxVal.value) * 70)
}
</script>

<style scoped>
.wcRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 32px;
  display: flex;
  flex-direction: column;
  font-family: var(--ff);
}

.wcHead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.wcEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.wcBrand {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.16em;
  color: var(--text-muted);
}

.wcDelta {
  margin-top: 24px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 64px;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.wcDeltaCaption {
  margin-top: 8px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wcChart {
  margin-top: 32px;
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.wcCol {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  height: 100%;
  align-items: center;
}

.wcVal {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.04em;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: var(--text-muted);
}

.wcValToday {
  color: var(--accent);
}

.wcValSpacer {
  display: block;
  height: 16px;
}

.wcBar {
  width: 100%;
  background: var(--border-strong);
  border-radius: 8px 8px 0 0;
  min-height: 8px;
}

.wcBarToday {
  background: var(--accent);
}

.wcBarMissing {
  background: transparent;
  border: 1px dashed var(--border-strong);
}

.wcDay {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.wcDayToday {
  color: var(--accent);
}

.wcFoot {
  margin-top: 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.wcFootRight {
  text-align: right;
}

.wcFootKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wcFootVal {
  margin-top: 4px;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wcFootValAccent {
  color: var(--accent);
}
</style>
