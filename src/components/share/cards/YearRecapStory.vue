<template>
  <div class="yrsRoot">
    <div class="yrsHead">
      <div class="yrsBrand">
        <span class="yrsMark">Logbook · Year in review</span>
        <span class="yrsHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
      <div class="yrsYear">{{ recap.year }}</div>
    </div>

    <div class="yrsHero">
      <div class="yrsLabel">Total volume</div>
      <div class="yrsNumber">{{ formattedVolume }}</div>
      <div class="yrsUnit">{{ unitNoun }} moved</div>
    </div>

    <div class="yrsStats">
      <div v-for="s in stats" :key="s.k" class="yrsStat">
        <div class="yrsStatVal">{{ s.v }}</div>
        <div class="yrsStatKey">{{ s.k }}</div>
      </div>
    </div>

    <div v-if="recap.topLift" class="yrsBlock">
      <div class="yrsBlockKey">Top lift</div>
      <div class="yrsBlockName">{{ recap.topLift.name }}</div>
      <div class="yrsBlockMeta">
        {{ recap.topLift.load }} × {{ recap.topLift.reps }}
        <span class="yrsBlockDot" aria-hidden="true">·</span>
        ~{{ recap.topLift.e1RM }} {{ recap.unitLabel }} e1RM
      </div>
    </div>

    <div v-if="recap.mostTrained" class="yrsBlock">
      <div class="yrsBlockKey">Most trained</div>
      <div class="yrsBlockName">{{ recap.mostTrained.name }}</div>
      <div class="yrsBlockMeta">{{ recap.mostTrained.sets.toLocaleString('en-US') }} sets</div>
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
  { k: 'SETS', v: props.recap.sets.toLocaleString('en-US') },
  { k: 'PRs', v: String(props.recap.prs) },
  { k: 'EXERCISES', v: String(props.recap.exercises) },
  { k: 'REPS', v: props.recap.reps.toLocaleString('en-US') },
  { k: 'WEEK STREAK', v: String(props.recap.longestStreakWeeks) },
])
</script>

<style scoped>
.yrsRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--ff);
}

.yrsHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.yrsBrand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yrsMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
}

.yrsHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.yrsYear {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 38px;
  line-height: 0.85;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.yrsHero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.yrsLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrsNumber {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 58px;
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.yrsStats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 18px 12px;
}

.yrsStat {
  border-top: 1px solid var(--border-strong);
  padding-top: 10px;
  min-width: 0;
}

.yrsStatVal {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 26px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.yrsStatKey {
  margin-top: 6px;
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

.yrsBlock {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yrsBlockKey {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrsBlockName {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsBlockMeta {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 12px;
  line-height: 1.3;
  letter-spacing: 0.04em;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsBlockDot {
  color: var(--text-muted);
  padding: 0 2px;
}
</style>
