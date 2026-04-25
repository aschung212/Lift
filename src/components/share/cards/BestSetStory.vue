<template>
  <div class="bsRoot">
    <div class="bsHead">
      <div class="bsEyebrow">🏆 {{ summary.bestSet?.isPR ? 'Personal record' : 'Best set' }}</div>
      <div class="bsDate">{{ summary.date }}</div>
    </div>

    <div v-if="summary.bestSet" class="bsHero">
      <div class="bsName">{{ summary.bestSet.name }}</div>
      <div class="bsWeight">{{ summary.bestSet.weight }}</div>
      <div class="bsReps">×&thinsp;{{ summary.bestSet.reps }} reps</div>
      <div class="bsE1RM">~{{ summary.bestSet.e1RM }} {{ summary.unitLabel }} e1RM</div>
    </div>

    <div class="bsBrand">LIFT</div>
  </div>
</template>

<script setup lang="ts">
import type { SessionSummary } from '../../../lib/sessionSummary'

defineProps<{ summary: SessionSummary }>()
</script>

<style scoped>
.bsRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  font-family: var(--ff);
}

.bsHead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.bsEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
}

.bsDate {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.bsHero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.bsName {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 36px;
  line-height: 1;
  letter-spacing: -0.02em;
  text-transform: uppercase;
}

.bsWeight {
  margin-top: 16px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 160px;
  line-height: 0.85;
  letter-spacing: -0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  text-shadow: 0 0 80px var(--accent-subtle);
}

.bsReps {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.bsE1RM {
  margin-top: 12px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.bsBrand {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.26em;
  color: var(--accent);
}
</style>
