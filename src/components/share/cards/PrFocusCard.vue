<template>
  <div class="prRoot">
    <div class="prHead">
      <div class="prEyebrow">🏆 New personal record</div>
      <div class="prDate">{{ summary.date }}</div>
    </div>

    <div v-if="summary.bestSet" class="prBody">
      <div class="prName">{{ summary.bestSet.name }}</div>
      <div class="prWeight">{{ summary.bestSet.weight }}</div>
      <div class="prReps">×&thinsp;{{ summary.bestSet.reps }} reps</div>
      <div class="prChip">
        <span class="prChipKey">e1RM</span>
        <span class="prChipVal">{{ summary.bestSet.e1RM }} {{ summary.unitLabel }}</span>
      </div>
    </div>

    <div class="prBrand">
      <span class="prMark">LIFT</span>
      <span class="prHandle">{{ SHARE_CARD_HANDLE }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

defineProps<{ summary: SessionSummary }>()
</script>

<style scoped>
.prRoot {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 50% 40%, var(--accent-subtle) 0%, transparent 70%),
    var(--bg-primary);
  color: var(--text-primary);
  padding: 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  font-family: var(--ff);
}

.prHead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.prEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--accent);
}

.prDate {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.prBody {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.prName {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 22px;
  line-height: 1;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.prWeight {
  margin-top: 8px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 96px;
  line-height: 0.9;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  text-shadow: 0 0 60px var(--accent-subtle);
}

.prReps {
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.prChip {
  margin-top: 16px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  padding: 8px 16px;
  border-radius: 999px;
}

.prChipKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.prChipVal {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.prBrand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.prMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.26em;
  color: var(--text-muted);
}

.prHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
</style>
