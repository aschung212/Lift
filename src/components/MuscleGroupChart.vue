<template>
  <div v-if="weeklyVolume.length > 0" class="mgChart">
    <p class="mgTitle">Weekly Volume by Muscle Group</p>
    <div class="mgBars" role="list" :aria-label="`Weekly muscle group volume: ${totalSets} total sets across ${weeklyVolume.length} muscle groups`">
      <div
        v-for="(item, index) in weeklyVolume"
        :key="item.group"
        class="mgRow"
        role="listitem"
        :aria-label="`${item.group}: ${item.sets} sets`"
      >
        <span class="mgLabel">{{ item.group }}</span>
        <div class="mgBarTrack">
          <div
            class="mgBarFill"
            :style="{
              width: `${(item.sets / maxSets) * 100}%`,
              opacity: 1 - (index * 0.08),
            }"
          ></div>
        </div>
        <span class="mgCount">{{ item.sets }}</span>
      </div>
    </div>
    <p class="mgTotal">{{ totalSets }} sets this week</p>
  </div>
</template>

<script setup lang="ts">
import type { MuscleGroupSets } from '../composables/useMuscleGroupVolume'

defineProps<{
  weeklyVolume: MuscleGroupSets[]
  maxSets: number
  totalSets: number
}>()
</script>

<style scoped>
.mgChart {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.mgTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.mgBars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mgRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.mgLabel {
  font-size: 12px;
  color: var(--text-secondary);
  width: 72px;
  flex-shrink: 0;
  text-align: right;
}

.mgBarTrack {
  flex: 1;
  height: 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  overflow: hidden;
}

.mgBarFill {
  height: 100%;
  border-radius: 8px;
  min-width: 4px;
  background-color: var(--accent);
  transition: width 0.3s ease;
}

.mgCount {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  width: 24px;
  text-align: right;
  flex-shrink: 0;
}

.mgTotal {
  font-size: 11px;
  color: var(--text-muted);
  margin: 8px 0 0;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .mgBarFill {
    transition: none;
  }
}
</style>
