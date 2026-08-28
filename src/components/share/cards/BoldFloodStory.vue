<template>
  <div class="bsRoot">
    <div class="bsHead">
      <div class="bsBrand">
        <span class="bsMark">Lift</span>
        <span class="bsHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
      <div class="bsDate">{{ summary.date }}</div>
    </div>

    <div class="bsHero">
      <div class="bsLabel">Total volume</div>
      <div class="bsNumber">{{ formattedVolume }}</div>
      <div class="bsUnit">{{ summary.unitLabel === 'kg' ? 'Kilograms' : 'Pounds' }} moved</div>
    </div>

    <div class="bsStats">
      <div v-for="s in stats" :key="s.k" class="bsStat">
        <div class="bsStatVal">{{ s.v }}</div>
        <div class="bsStatKey">{{ s.k }}</div>
      </div>
    </div>

    <div class="bsFoot">Tap to see best set →</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const formattedVolume = computed(() => props.summary.totalVolume.toLocaleString('en-US'))

const stats = computed(() => [
  { k: 'TIME', v: props.summary.duration },
  { k: 'SETS', v: String(props.summary.setsCompleted) },
  { k: 'PRs', v: String(props.summary.prs + props.summary.repPRs) },
])
</script>

<style scoped>
.bsRoot {
  position: absolute;
  inset: 0;
  background: var(--accent);
  color: var(--bg-primary);
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--ff);
}

.bsHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bsBrand {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bsMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.bsHandle {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

.bsDate {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.7;
}

.bsHero {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bsLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.7;
}

.bsNumber {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 58px;
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bsUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 14px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.7;
}

.bsStats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}

.bsStat {
  border-top: 1px solid rgba(0, 0, 0, 0.25);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bsStatVal {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 32px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.bsStatKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.18em;
  opacity: 0.7;
}

.bsFoot {
  text-align: center;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.7;
}
</style>
