<template>
  <div class="pgRoot">
    <div class="pgHead">
      <div class="pgEyebrow">Progress</div>
      <div v-if="p" class="pgSpan">in {{ p.spanLabel }}</div>
    </div>

    <div v-if="p" class="pgHero">
      <div class="pgName">{{ p.name }}</div>
      <div class="pgDelta">
        <span class="pgDeltaSign">+</span>{{ p.delta }}
        <span class="pgDeltaUnit">{{ summary.unitLabel }}</span>
      </div>
      <div class="pgJourney">
        <span class="pgFrom">{{ p.startE1RM }}</span>
        <span class="pgArrow" aria-hidden="true">&rarr;</span>
        <span class="pgTo">{{ p.currentE1RM }}</span>
        <span class="pgMetric">{{ summary.unitLabel }} e1RM</span>
      </div>
    </div>

    <div class="pgFoot">
      <div class="pgTagline">Estimated 1-rep max</div>
      <div class="pgBrand">
        <span class="pgMark">LIFT</span>
        <span class="pgHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const p = computed(() => props.summary.progress)
</script>

<style scoped>
.pgRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-family: var(--ff);
}

.pgHead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.pgEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.pgSpan {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.pgHero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.pgName {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 28px;
  line-height: 1;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.pgDelta {
  margin-top: 12px;
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 88px;
  line-height: 0.9;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  text-shadow: 0 0 60px var(--accent-subtle);
}

.pgDeltaSign {
  font-size: 56px;
  letter-spacing: -0.02em;
}

.pgDeltaUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.pgJourney {
  margin-top: 20px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}

.pgFrom {
  font-family: var(--ff-display);
  font-weight: 600;
  font-size: 24px;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text-muted);
}

.pgArrow {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  color: var(--text-secondary);
}

.pgTo {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 32px;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.pgMetric {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pgFoot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.pgTagline {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.pgBrand {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}

.pgMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  color: var(--accent);
}

.pgHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
</style>
