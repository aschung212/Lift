<template>
  <div class="sgRoot">
    <div class="sgHead">
      <div class="sgBrand">
        <span class="sgEyebrow">Lift · {{ weekdayLabel }}</span>
        <span class="sgHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
      <div class="sgDate">{{ summary.date }}</div>
    </div>
    <div
      v-for="(s, i) in cells"
      :key="s.k"
      class="sgCell"
      :class="{ sgCellAccent: s.accent, sgCellRight: i % 2 === 1, sgCellBottom: i >= 2 }"
    >
      <div class="sgKey">{{ s.k }}</div>
      <div class="sgVal" :class="`sgVal--${s.size}`">{{ s.v }}</div>
      <div class="sgUnit">{{ s.unit }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const weekdayLabel = computed(() => props.summary.date.split(',')[0])
const formattedVolume = computed(() => props.summary.totalVolume.toLocaleString('en-US'))

interface Cell {
  k: string
  v: string
  unit: string
  accent?: boolean
  size: 'sm' | 'md' | 'lg'
}

const cells = computed<Cell[]>(() => {
  const best = props.summary.bestSet
  const total = props.summary.prs + props.summary.repPRs
  return [
    {
      k: 'VOLUME',
      v: formattedVolume.value,
      unit: props.summary.unitLabel.toUpperCase(),
      size: formattedVolume.value.length >= 5 ? 'sm' : 'md',
    },
    {
      k: 'BEST SET',
      v: best ? `${best.weight}×${best.reps}` : '—',
      unit: best ? best.name.toUpperCase() : '—',
      accent: true,
      size: 'sm',
    },
    {
      k: 'SETS',
      v: String(props.summary.setsCompleted),
      unit: `${props.summary.exercises} ${props.summary.exercises === 1 ? 'EXERCISE' : 'EXERCISES'}`,
      size: 'lg',
    },
    {
      k: 'PRs',
      v: String(total),
      unit: `${props.summary.prs} WT · ${props.summary.repPRs} REP`,
      accent: true,
      size: 'lg',
    },
  ]
})
</script>

<style scoped>
.sgRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr 1fr;
  font-family: var(--ff);
}

.sgHead {
  grid-column: 1 / 3;
  padding: 24px 28px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-strong);
}

.sgBrand {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sgEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.sgHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.sgDate {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.sgCell {
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  overflow: hidden;
}

.sgCellRight {
  border-left: 1px solid var(--border-strong);
}

.sgCellBottom {
  border-top: 1px solid var(--border-strong);
}

.sgCellAccent {
  background: var(--bg-secondary);
}

.sgKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sgVal {
  font-family: var(--ff-display);
  font-weight: 800;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
}

.sgVal--sm { font-size: 32px; line-height: 1; }
.sgVal--md { font-size: 48px; line-height: 1; }
.sgVal--lg { font-size: 56px; line-height: 1; }

.sgCellAccent .sgVal {
  color: var(--accent);
}

.sgUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1.2;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
