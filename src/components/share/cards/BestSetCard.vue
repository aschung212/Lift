<template>
  <div class="bsRoot">
    <div class="bsHead">
      <div class="bsHeadLeft">
        <div class="bsEyebrow">Best set</div>
        <div class="bsPRLabel">{{ prLabel }}</div>
      </div>
      <div class="bsDate">{{ summary.date }}</div>
    </div>

    <div v-if="summary.bestSet" class="bsHero">
      <div class="bsName">{{ summary.bestSet.name }}</div>
      <div class="bsNumberRow">
        <div class="bsWeight" :class="{ bsWeightWord: loadIsWord }">{{ summary.bestSet.load.value }}</div>
        <div class="bsRepsBlock">
          <div class="bsRepsLabel">{{ repsLabel }}</div>
          <div class="bsReps">{{ summary.bestSet.reps }}</div>
        </div>
      </div>
    </div>

    <div class="bsFoot">
      <div class="bsE1RM" v-if="summary.bestSet">~{{ summary.bestSet.e1RM }} {{ summary.unitLabel }} e1RM</div>
      <div class="bsBrand">
        <span class="bsMark">LOGBOOK</span>
        <span class="bsHandle">{{ SHARE_CARD_HANDLE }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'
import { SHARE_CARD_HANDLE } from '../../../lib/shareImage'

const props = defineProps<{ summary: SessionSummary }>()

const prLabel = computed(() => (props.summary.bestSet?.isPR ? 'New personal record' : 'Top set'))

const bestLoad = computed(() => props.summary.bestSet?.load ?? null)

/**
 * A null unit means the load is already a phrase — "Bodyweight", the ordinary
 * pull-up (#1385). Two consequences for this card, and they are the same fact
 * twice: the unit must not be appended (`Bodyweight LBS`), and the value is a
 * ten-letter word sitting in a 68px numeral slot that has to shrink for it.
 */
const loadIsWord = computed(() => bestLoad.value !== null && bestLoad.value.unit === null)

const repsLabel = computed(() =>
  bestLoad.value?.unit ? `${bestLoad.value.unit.toUpperCase()} ×` : '×',
)
</script>

<style scoped>
.bsRoot {
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

.bsHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.bsEyebrow {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bsPRLabel {
  margin-top: 4px;
  font-family: var(--ff-mono);
  font-weight: 600;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.16em;
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

.bsName {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bsNumberRow {
  margin-top: 16px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.bsWeight {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 68px;
  line-height: 1;
  letter-spacing: -0.05em;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

/* The slot holds a NUMBER at 68px; "Bodyweight" is ten letters and overruns
   the 296px card at that size, so a worded load gets word-sized type (#1385).
   The card is a fixed 360x360 canvas rasterized offscreen, so there is no
   viewport to reflow against and no user to notice an overflow before the PNG
   is posted — the size has to be decided here. */
.bsWeightWord {
  font-size: 34px;
  letter-spacing: -0.02em;
}

.bsRepsBlock {
  display: flex;
  flex-direction: column;
}

.bsRepsLabel {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.16em;
  color: var(--text-muted);
}

.bsReps {
  margin-top: 8px;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 36px;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.bsFoot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.bsE1RM {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.bsBrand {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}

.bsMark {
  font-family: var(--ff-mono);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.22em;
  color: var(--accent);
}

.bsHandle {
  font-family: var(--ff-mono);
  font-weight: 500;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
</style>
