<template>
  <div class="rcRoot">
    <div class="rcBrandLine">LIFT &nbsp;·&nbsp; RECEIPT</div>

    <div class="rcMeta">
      <span>{{ summary.date.toUpperCase() }}</span>
      <span>{{ summary.duration }}</span>
    </div>

    <div class="rcLines">
      <div v-for="(h, i) in displayedHighlights" :key="h.exerciseId + i" class="rcLine">
        <span class="rcName">{{ h.name }}</span>
        <span class="rcWeight">
          {{ h.weight }}×{{ h.reps }}<template v-if="h.badge">&nbsp;★</template>
        </span>
      </div>
      <div v-if="hiddenCount > 0" class="rcLineMore">+{{ hiddenCount }} more</div>
    </div>

    <div class="rcSubtotal">
      <span>SUBTOTAL</span>
      <span>{{ formattedVolume }} {{ summary.unitLabel.toUpperCase() }}</span>
    </div>

    <div class="rcLine rcLine--small">
      <span>PRS</span>
      <span>{{ summary.prs }} WT &nbsp; {{ summary.repPRs }} REP</span>
    </div>

    <div class="rcThanks">— THANK YOU —</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../../../lib/sessionSummary'

const props = defineProps<{ summary: SessionSummary }>()

/** Receipt fits ~8 lines comfortably; longer days truncate with "+N more". */
const MAX_LINES = 8

const displayedHighlights = computed(() => props.summary.highlights.slice(0, MAX_LINES))
const hiddenCount = computed(() => Math.max(0, props.summary.highlights.length - MAX_LINES))
const formattedVolume = computed(() => props.summary.totalVolume.toLocaleString('en-US'))
</script>

<style scoped>
/* The receipt is an intentional opt-out of theme tokens — the cream paper
   is part of the "physical receipt" metaphor and would lose its meaning
   tinted with theme colors. Documented in plan + CLAUDE-context. */
.rcRoot {
  position: absolute;
  inset: 0;
  background: #f6f4ee;
  color: #1a1a14;
  padding: 32px;
  font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', monospace;
  display: flex;
  flex-direction: column;
}

.rcBrandLine {
  text-align: center;
  font-weight: 700;
  letter-spacing: 0.3em;
  font-size: 14px;
  border-bottom: 2px dashed #1a1a14;
  padding-bottom: 12px;
}

.rcMeta {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  font-size: 12px;
}

.rcLines {
  margin-top: 16px;
  font-size: 13px;
  line-height: 1.7;
  flex: 1;
}

.rcLine {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px dashed rgba(26, 26, 20, 0.25);
  padding: 4px 0;
}

.rcName {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 65%;
}

.rcWeight {
  font-weight: 700;
}

.rcLineMore {
  text-align: center;
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.6;
  letter-spacing: 0.08em;
}

.rcSubtotal {
  border-top: 2px dashed #1a1a14;
  padding-top: 16px;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
}

.rcLine--small {
  font-size: 12px;
  margin-top: 8px;
  border-bottom: 0;
  padding: 0;
}

.rcThanks {
  text-align: center;
  margin-top: 16px;
  font-size: 10px;
  letter-spacing: 0.3em;
  opacity: 0.6;
}
</style>
