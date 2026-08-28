<template>
  <div class="tsRoot">
    <div class="tsTicket">
      <div class="tsLeft">
        <div>
          <div class="tsEyebrow">Lift · Session</div>
          <div class="tsHandle">{{ SHARE_CARD_HANDLE }}</div>
          <div class="tsTitle">Workout</div>
          <div class="tsMeta">{{ summary.date.toUpperCase() }} · {{ summary.duration }}</div>
        </div>
        <div v-if="summary.bestSet">
          <div class="tsKey">Headliner</div>
          <div class="tsHead">{{ summary.bestSet.name }}</div>
          <div class="tsHeadStat">
            {{ summary.bestSet.weight }}×{{ summary.bestSet.reps }} {{ summary.unitLabel }}
          </div>
        </div>
      </div>

      <div class="tsPerf" aria-hidden="true"></div>

      <div class="tsStub">
        <div class="tsStubLabel">VOLUME</div>
        <div class="tsStubNumber">{{ formattedVolume }}</div>
        <div class="tsStubLabel">{{ summary.unitLabel.toUpperCase() }}</div>
      </div>

      <div class="tsNotchLeft" aria-hidden="true"></div>
      <div class="tsNotchRight" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const formattedVolume = computed(() => Math.round(props.summary.totalVolume).toLocaleString('en-US'))
</script>

<style scoped>
.tsRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  background-image: var(--mesh);
  color: var(--text-primary);
  padding: 24px;
  display: flex;
  align-items: center;
  font-family: var(--ff);
}

.tsTicket {
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 1fr auto 128px;
  overflow: hidden;
  position: relative;
}

.tsLeft {
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.tsEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
}

.tsHandle {
  margin-top: 6px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.tsTitle {
  margin-top: 16px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 36px;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.tsMeta {
  margin-top: 8px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.tsKey {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tsHead {
  margin-top: 8px;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 14px;
  line-height: 1.2;
  color: var(--accent);
}

.tsHeadStat {
  margin-top: 4px;
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.tsPerf {
  width: 2px;
  background: repeating-linear-gradient(to bottom, var(--bg-primary) 0 4px, transparent 4px 12px);
}

.tsStub {
  padding: 24px 16px;
  background: var(--accent);
  color: var(--bg-primary);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  text-align: center;
}

.tsStubLabel {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.24em;
}

.tsStubNumber {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 32px;
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.tsNotchLeft,
.tsNotchRight {
  position: absolute;
  width: 16px;
  height: 16px;
  background: var(--bg-primary);
  border-radius: 50%;
  top: 50%;
  transform: translateY(-50%);
}

.tsNotchLeft { left: -8px; }
.tsNotchRight { right: -8px; }
</style>
