<template>
  <div class="yrsRoot">
    <header class="yrsHead">
      <span class="yrsEyebrow">Year in Review</span>
      <span class="yrsYear">{{ recap.year }}</span>
    </header>

    <div class="yrsHero">
      <span class="yrsVolumeValue" :class="`yrsVolumeValue--${volumeSize}`">{{ volumeLabel }}</span>
      <span class="yrsVolumeUnit">{{ recap.unitLabel }} moved</span>
    </div>

    <div class="yrsStats">
      <div v-for="s in stats" :key="s.label" class="yrsStat">
        <span class="yrsStatValue">{{ s.value }}</span>
        <span class="yrsStatLabel">{{ s.label }}</span>
      </div>
    </div>

    <div class="yrsChart" role="img" :aria-label="chartLabel">
      <div v-for="(m, i) in months" :key="i" class="yrsBarCol">
        <div class="yrsBarTrack">
          <div class="yrsBar" :class="{ yrsBarPeak: i === recap.busiestMonth }" :style="{ height: m.height }"></div>
        </div>
        <span class="yrsBarLabel">{{ m.initial }}</span>
      </div>
    </div>

    <div class="yrsHighlights">
      <div v-if="recap.bestLift" class="yrsHighlight">
        <span class="yrsHighlightKey">Best lift</span>
        <span class="yrsHighlightValue">{{ recap.bestLift.name }}</span>
        <span class="yrsHighlightMeta">
          {{ recap.bestLift.loadLabel }} × {{ recap.bestLift.reps }} · ~{{ recap.bestLift.e1RM }} {{ recap.unitLabel }} e1RM
        </span>
      </div>
      <div v-if="recap.topTag" class="yrsHighlight">
        <span class="yrsHighlightKey">Most trained</span>
        <span class="yrsHighlightValue">{{ recap.topTag.tag }}</span>
        <span class="yrsHighlightMeta">{{ recap.topTag.sets }} sets across {{ recap.exercises }} exercises</span>
      </div>
    </div>

    <footer class="yrsFoot">
      <span class="yrsHandle">{{ SHARE_CARD_HANDLE }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  recapChartLabel,
  recapHeadlineStats,
  recapMonthBars,
  recapVolumeLabel,
  recapVolumeSize,
  type YearRecap,
} from '../../../lib/yearRecap'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ recap: YearRecap }>()

// Shared with YearRecapCard — this card is the same recap in a 9:16 layout,
// so the numbers and the chart's accessible name come from one owner.
const volumeLabel = computed(() => recapVolumeLabel(props.recap))
const volumeSize = computed(() => recapVolumeSize(props.recap))
const stats = computed(() => recapHeadlineStats(props.recap))
const months = computed(() => recapMonthBars(props.recap))
const chartLabel = computed(() => recapChartLabel(props.recap))
</script>

<style scoped>
.yrsRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  font-family: var(--ff);
  padding: 48px 32px 40px;
  gap: 24px;
}

.yrsHead {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yrsEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent);
}

.yrsYear {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 92px;
  line-height: 0.86;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.yrsHero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 0;
  border-top: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
}

.yrsVolumeValue {
  font-family: var(--ff-display);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  white-space: nowrap;
}

.yrsVolumeValue--lg { font-size: 60px; }
.yrsVolumeValue--md { font-size: 50px; }
.yrsVolumeValue--sm { font-size: 40px; }

.yrsVolumeUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrsStats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px 16px;
}

.yrsStat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.yrsStatValue {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 40px;
  line-height: 1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.yrsStatLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsChart {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 5px;
  align-items: stretch;
}

.yrsBarCol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
}

.yrsBarTrack {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.yrsBar {
  width: 100%;
  background: var(--text-secondary);
  border-radius: 4px;
}

.yrsBarPeak {
  background: var(--accent);
}

.yrsBarLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.06em;
  text-align: center;
  color: var(--text-muted);
}

.yrsHighlights {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.yrsHighlight {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.yrsHighlightKey {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrsHighlightValue {
  font-family: var(--ff);
  font-weight: 700;
  font-size: 20px;
  line-height: 1.1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsHighlightMeta {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrsFoot {
  display: flex;
  justify-content: flex-start;
}

.yrsHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
</style>
