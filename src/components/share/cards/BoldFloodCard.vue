<template>
  <div class="bfRoot">
    <div class="bfHead">
      <div class="bfBrand">
        <span class="bfMark">Lift</span>
        <span class="bfHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
      <div class="bfDate">{{ summary.date }}</div>
    </div>

    <div class="bfHero">
      <div class="bfNumber">{{ formattedVolume }}</div>
      <div class="bfUnit">{{ summary.unitLabel === 'kg' ? 'Kilograms' : 'Pounds' }} moved</div>
    </div>

    <div class="bfStats">
      <div class="bfStat">
        <div class="bfStatVal">{{ summary.duration }}</div>
        <div class="bfStatKey">TIME</div>
      </div>
      <div class="bfStat">
        <div class="bfStatVal">{{ summary.setsCompleted }}</div>
        <div class="bfStatKey">SETS</div>
      </div>
      <div class="bfStat">
        <div class="bfStatVal">{{ summary.prs + summary.repPRs }}</div>
        <div class="bfStatKey">PRs</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const formattedVolume = computed(() => props.summary.totalVolume.toLocaleString('en-US'))
</script>

<style scoped>
.bfRoot {
  position: absolute;
  inset: 0;
  background: var(--accent);
  color: var(--bg-primary);
  padding: 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--ff);
}

.bfHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bfBrand {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bfMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.bfHandle {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  opacity: 0.65;
}

.bfDate {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.65;
}

.bfHero {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bfNumber {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 60px;
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bfUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.7;
}

.bfStats {
  display: flex;
  gap: 24px;
  align-items: flex-end;
}

.bfStat {
  display: flex;
  flex-direction: column;
}

.bfStatVal {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 28px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.bfStatKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.18em;
  opacity: 0.65;
  margin-top: 4px;
}
</style>
