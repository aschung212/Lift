<template>
  <div class="yrRoot">
    <div class="yrHead">
      <div class="yrBrand">
        <span class="yrMark">Logbook · Year in review</span>
        <span class="yrHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
      <div class="yrYear">{{ recap.year }}</div>
    </div>

    <div class="yrHero">
      <div class="yrNumber">{{ formattedVolume }}</div>
      <div class="yrUnit">{{ unitNoun }} moved</div>
    </div>

    <div class="yrStats">
      <div v-for="s in stats" :key="s.k" class="yrStat">
        <div class="yrStatVal">{{ s.v }}</div>
        <div class="yrStatKey">{{ s.k }}</div>
      </div>
    </div>

    <div class="yrFoot">
      <div v-if="recap.topLift" class="yrRow">
        <span class="yrRowKey">Top lift</span>
        <span class="yrRowVal">
          <span class="yrRowName">{{ recap.topLift.name }}</span>
          <span class="yrRowMeta">{{ recap.topLift.load }} × {{ recap.topLift.reps }}</span>
        </span>
      </div>
      <div v-if="recap.mostTrained" class="yrRow">
        <span class="yrRowKey">Most trained</span>
        <span class="yrRowVal">
          <span class="yrRowName">{{ recap.mostTrained.name }}</span>
          <span class="yrRowMeta">{{ recap.mostTrained.sets }} sets</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { YearRecap } from '../../../lib/yearRecap'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ recap: YearRecap }>()

const formattedVolume = computed(() => props.recap.totalVolume.toLocaleString('en-US'))
const unitNoun = computed(() => (props.recap.unitLabel === 'kg' ? 'Kilograms' : 'Pounds'))

const stats = computed(() => [
  { k: 'WORKOUTS', v: props.recap.workouts.toLocaleString('en-US') },
  { k: 'PRs', v: String(props.recap.prs) },
  { k: 'WEEK STREAK', v: String(props.recap.longestStreakWeeks) },
])
</script>

<style scoped>
.yrRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 30px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--ff);
}

.yrHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.yrBrand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yrMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
}

.yrHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.yrYear {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 34px;
  line-height: 0.85;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.yrHero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.yrNumber {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 52px;
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.yrStats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.yrStat {
  border-top: 1px solid var(--border-strong);
  padding-top: 10px;
  min-width: 0;
}

.yrStatVal {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 26px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.yrStatKey {
  margin-top: 5px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrFoot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yrRow {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.yrRowKey {
  flex: 0 0 auto;
  width: 96px;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrRowVal {
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.yrRowName {
  font-family: var(--ff);
  font-weight: 700;
  font-size: 14px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrRowMeta {
  flex: 0 0 auto;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.04em;
  color: var(--accent);
  white-space: nowrap;
}
</style>
