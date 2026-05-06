<template>
  <div class="drRoot">
    <div class="drGoal">Goal · {{ formattedGoal }} {{ summary.unitLabel }}</div>

    <div class="drRingWrap">
      <svg viewBox="0 0 200 200" class="drRing">
        <circle cx="100" cy="100" r="86" fill="none" stroke="var(--border-strong)" stroke-width="14" />
        <circle
          cx="100"
          cy="100"
          r="86"
          fill="none"
          stroke="var(--accent)"
          stroke-width="14"
          stroke-linecap="round"
          :stroke-dasharray="`${dashLength} 540`"
        />
      </svg>
      <div class="drRingCenter">
        <div class="drPercent">{{ percent }}%</div>
        <div class="drCenterLabel">DAILY GOAL</div>
      </div>
    </div>

    <div class="drBody">
      <div class="drVolume">
        {{ formattedVolume }} <span class="drVolumeUnit">{{ summary.unitLabel.toUpperCase() }}</span>
      </div>
      <div class="drMeta">
        <span>{{ summary.duration }}</span>
        <span>·</span>
        <span>{{ summary.setsCompleted }} sets</span>
        <span>·</span>
        <span class="drMetaAccent">{{ summary.prs + summary.repPRs }} PR</span>
      </div>
    </div>

    <div class="drBrand">LIFT</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'

const props = defineProps<{ summary: SessionSummary }>()

/** Default daily goal — kept simple; future iteration can pull from progression store. */
const GOAL = computed(() => (props.summary.unitLabel === 'kg' ? 10000 : 22000))
const ringRatio = computed(() => Math.min(1, props.summary.totalVolume / GOAL.value))
const percent = computed(() => Math.round(ringRatio.value * 100))
const dashLength = computed(() => +(ringRatio.value * 540).toFixed(1))

const formattedVolume = computed(() => Math.round(props.summary.totalVolume).toLocaleString('en-US'))
const formattedGoal = computed(() => GOAL.value.toLocaleString('en-US'))
</script>

<style scoped>
.drRoot {
  position: absolute;
  inset: 0;
  background: #000;
  background-image: radial-gradient(ellipse at 50% 50%, var(--accent-subtle) 0%, transparent 70%);
  color: var(--text-primary);
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  font-family: var(--ff);
}

.drGoal {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.drRingWrap {
  position: relative;
  width: 200px;
  height: 200px;
}

.drRing {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.drRingCenter {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.drPercent {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 44px;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.drCenterLabel {
  margin-top: 4px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.18em;
  color: var(--text-muted);
}

.drBody {
  text-align: center;
}

.drVolume {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.drVolumeUnit {
  margin-left: 4px;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.drMeta {
  margin-top: 8px;
  display: flex;
  gap: 12px;
  justify-content: center;
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.drMetaAccent {
  color: var(--accent);
}

.drBrand {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.22em;
  color: var(--accent);
}
</style>
