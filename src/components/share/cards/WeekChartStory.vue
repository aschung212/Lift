<template>
  <div class="wsRoot">
    <div class="wsHead">
      <div class="wsEyebrow">Week {{ weekdayLabel }}</div>
      <div class="wsBrand">LIFT</div>
    </div>

    <div class="wsHero">
      <div class="wsDelta">{{ deltaLabel }}</div>
      <div class="wsCaption">Vs last week</div>
    </div>

    <div class="wsChart">
      <div v-for="(v, i) in summary.weekVolume" :key="i" class="wsCol">
        <span v-if="v" class="wsVal" :class="{ wsValToday: i === todayIdx }">
          {{ (v / 1000).toFixed(1) }}K
        </span>
        <span v-else class="wsValSpacer"></span>
        <div
          class="wsBar"
          :class="{ wsBarToday: i === todayIdx, wsBarMissing: !v }"
          :style="{ height: barPercent(v) + '%' }"
        ></div>
        <span class="wsDay" :class="{ wsDayToday: i === todayIdx }">{{ DAY_LABELS[i] }}</span>
      </div>
    </div>

    <div class="wsFoot">
      <div>
        <div class="wsFootKey">Today</div>
        <div class="wsFootVal wsFootValAccent">{{ formattedToday }} {{ summary.unitLabel }}</div>
      </div>
      <div class="wsFootRight">
        <div class="wsFootKey">Streak</div>
        <div class="wsFootVal">🔥 {{ summary.streak }}wk</div>
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
  const [y, m, d] = props.summary.rawDate.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
})

const weekdayLabel = computed(() => props.summary.date.split(',')[0])
const formattedToday = computed(() => Math.round(props.summary.totalVolume).toLocaleString('en-US'))

const deltaLabel = computed(() => {
  if (props.summary.priorWeekVolume === 0) {
    return props.summary.totalVolume === 0 ? '0%' : 'NEW'
  }
  const thisWeek = props.summary.weekVolume.reduce((s, v) => s + v, 0)
  const pct = ((thisWeek - props.summary.priorWeekVolume) / props.summary.priorWeekVolume) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${Math.round(pct)}%`
})

const maxVal = computed(() => Math.max(1, ...props.summary.weekVolume))
function barPercent(v: number): number {
  if (v <= 0) return 3
  return Math.max(6, (v / maxVal.value) * 65)
}
</script>

<style scoped>
.wsRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  font-family: var(--ff);
}

.wsHead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.wsEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
}

.wsBrand {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.wsHero {
  margin-top: 32px;
}

.wsDelta {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 96px;
  line-height: 0.9;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.wsCaption {
  margin-top: 8px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wsChart {
  margin-top: 40px;
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.wsCol {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  height: 100%;
  justify-content: flex-end;
}

.wsVal {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  color: var(--text-muted);
}

.wsValToday {
  color: var(--accent);
}

.wsValSpacer {
  display: block;
  height: 16px;
}

.wsBar {
  width: 100%;
  background: var(--border-strong);
  border-radius: 8px 8px 0 0;
  min-height: 8px;
}

.wsBarToday {
  background: var(--accent);
}

.wsBarMissing {
  background: transparent;
  border: 1px dashed var(--border-strong);
}

.wsDay {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.wsDayToday {
  color: var(--accent);
}

.wsFoot {
  margin-top: 24px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}

.wsFootRight {
  text-align: right;
}

.wsFootKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wsFootVal {
  margin-top: 4px;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.wsFootValAccent {
  color: var(--accent);
}
</style>
