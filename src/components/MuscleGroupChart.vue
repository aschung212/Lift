<template>
  <div v-if="weeklyVolume.length > 0" class="mgChart">
    <div class="mgHeader">
      <p class="mgTitle">Weekly Volume by Muscle Group</p>
      <button
        class="mgViewToggle"
        :aria-label="`Switch to ${showHeatmap ? 'bar chart' : 'body heatmap'} view`"
        @click="showHeatmap = !showHeatmap"
      >
        <svg v-if="!showHeatmap" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="3" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="12" y1="16" x2="8" y2="22" />
          <line x1="12" y1="16" x2="16" y2="22" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="20" x2="4" y2="14" />
          <line x1="9" y1="20" x2="9" y2="8" />
          <line x1="14" y1="20" x2="14" y2="4" />
          <line x1="19" y1="20" x2="19" y2="11" />
        </svg>
      </button>
    </div>

    <BodyHeatmap
      v-if="showHeatmap"
      :weekly-volume="weeklyVolume"
      :max-sets="maxSets"
    />

    <template v-else>
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
    </template>

    <p class="mgTotal">{{ totalSets }} sets this week</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { MuscleGroupSets } from '../composables/useMuscleGroupVolume'
import BodyHeatmap from './BodyHeatmap.vue'

defineProps<{
  weeklyVolume: MuscleGroupSets[]
  maxSets: number
  totalSets: number
}>()

const showHeatmap = ref(false)
</script>

<style scoped>
.mgChart {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.mgHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.mgTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.mgViewToggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s;
}

.mgViewToggle:active {
  background: var(--border);
}

.mgBars {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  .mgViewToggle {
    transition: none;
  }
}
</style>
