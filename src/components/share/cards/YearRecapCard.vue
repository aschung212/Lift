<template>
  <div class="yrRoot">
    <header class="yrHead">
      <span class="yrEyebrow">Lift · Year in Review</span>
      <span class="yrHandle">{{ SHARE_CARD_HANDLE }}</span>
    </header>

    <div class="yrHero">
      <span class="yrYear">{{ recap.year }}</span>
      <div class="yrVolume">
        <span class="yrVolumeValue" :class="`yrVolumeValue--${volumeSize}`">{{ volumeLabel }}</span>
        <span class="yrVolumeUnit">{{ recap.unitLabel }} moved</span>
      </div>
    </div>

    <div class="yrStats">
      <div v-for="s in stats" :key="s.label" class="yrStat">
        <span class="yrStatValue">{{ s.value }}</span>
        <span class="yrStatLabel">{{ s.label }}</span>
      </div>
    </div>

    <div class="yrChart" role="img" :aria-label="chartLabel">
      <div v-for="(m, i) in months" :key="i" class="yrBarCol">
        <div class="yrBarTrack">
          <div class="yrBar" :class="{ yrBarPeak: i === recap.busiestMonth }" :style="{ height: m.height }"></div>
        </div>
        <span class="yrBarLabel">{{ m.initial }}</span>
      </div>
    </div>

    <footer class="yrFoot">
      <div v-if="recap.bestLift" class="yrFootRow">
        <span class="yrFootKey">Best lift</span>
        <span class="yrFootValue">{{ recap.bestLift.name }}</span>
        <span class="yrFootMeta">{{ recap.bestLift.loadLabel }} × {{ recap.bestLift.reps }}</span>
      </div>
      <div v-if="recap.topTag" class="yrFootRow">
        <span class="yrFootKey">Most trained</span>
        <span class="yrFootValue">{{ recap.topTag.tag }}</span>
        <span class="yrFootMeta">{{ recap.topTag.sets }} sets</span>
      </div>
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

// Every derivation is shared with YearRecapStory — same numbers, same axis
// stubs, same accessible name, two layouts. See the note in `yearRecap.ts`.
const volumeLabel = computed(() => recapVolumeLabel(props.recap))
const volumeSize = computed(() => recapVolumeSize(props.recap))
const stats = computed(() => recapHeadlineStats(props.recap))
const months = computed(() => recapMonthBars(props.recap))
const chartLabel = computed(() => recapChartLabel(props.recap))
</script>

<style scoped>
.yrRoot {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  font-family: var(--ff);
  /* Extra bottom padding clears the absolutely-positioned free-tier watermark
     (bottom: 12px) so the last footer row never collides with it. */
  padding: 20px 24px 30px;
  gap: 12px;
}

.yrHead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.yrEyebrow {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
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

.yrHero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.yrYear {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 68px;
  line-height: 0.9;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.yrVolume {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
}

.yrVolumeValue {
  font-family: var(--ff-display);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  white-space: nowrap;
}

.yrVolumeValue--lg { font-size: 34px; }
.yrVolumeValue--md { font-size: 28px; }
.yrVolumeValue--sm { font-size: 22px; }

.yrVolumeUnit {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
}

.yrStats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px 0;
  border-top: 1px solid var(--border-strong);
  border-bottom: 1px solid var(--border-strong);
}

.yrStat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.yrStatValue {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 26px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.yrStatLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 8px;
  line-height: 1.2;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrChart {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 4px;
  align-items: stretch;
}

.yrBarCol {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  min-height: 0;
}

.yrBarTrack {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-end;
  background: var(--bg-secondary);
  border-radius: 3px;
  overflow: hidden;
}

.yrBar {
  width: 100%;
  background: var(--text-secondary);
  border-radius: 3px;
}

.yrBarPeak {
  background: var(--accent);
}

.yrBarLabel {
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 8px;
  line-height: 1;
  letter-spacing: 0.06em;
  text-align: center;
  color: var(--text-muted);
}

.yrFoot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yrFootRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.yrFootKey {
  flex: 0 0 auto;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 8px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.yrFootValue {
  flex: 1 1 auto;
  font-family: var(--ff);
  font-weight: 700;
  font-size: 13px;
  line-height: 1.1;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yrFootMeta {
  flex: 0 0 auto;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  white-space: nowrap;
}
</style>
