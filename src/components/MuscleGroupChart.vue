<template>
  <div v-if="weeklyVolume.length > 0" class="mgChart">
    <button class="mgHeader" :aria-expanded="!collapsed" @click="$emit('toggleCollapsed')">
      <p class="mgTitle">Weekly Volume by Tag</p>
      <div class="mgHeaderRight">
        <span v-if="collapsed" class="mgCollapsedSummary">{{ totalSets }} sets</span>
        <svg class="mgChevron" :class="{ mgChevronOpen: !collapsed }" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>

    <template v-if="!collapsed">
      <div class="mgBars" role="list" :aria-label="`Weekly tag volume: ${totalSets} total sets across ${weeklyVolume.length} tags`">
        <div
          v-for="(item, index) in weeklyVolume"
          :key="item.tag"
          class="mgRow"
          role="listitem"
          :aria-label="`${item.tag}: ${item.sets} sets`"
        >
          <span class="mgLabel">{{ item.tag }}</span>
          <div class="mgBarTrack">
            <div
              class="mgBarFill"
              :style="{
                width: `${(item.sets / maxSets) * 100}%`,
                opacity: 1 - (index * 0.06),
              }"
            ></div>
          </div>
          <span class="mgCount">{{ item.sets }}</span>
        </div>
      </div>

      <p class="mgTotal">{{ totalSets }} sets this week</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { TagVolume } from '../composables/useTagVolume'

defineProps<{
  weeklyVolume: TagVolume[]
  maxSets: number
  totalSets: number
  collapsed?: boolean
}>()

defineEmits<{
  toggleCollapsed: []
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

.mgHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  color: inherit;
  font: inherit;
  min-height: 44px;
}

.mgHeader:active {
  opacity: 0.6;
}

.mgTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  text-align: left;
}

.mgHeaderRight {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mgCollapsedSummary {
  font-size: 12px;
  color: var(--text-muted);
}

.mgChevron {
  color: var(--text-muted);
  transition: transform 0.2s;
}

.mgChevronOpen {
  transform: rotate(180deg);
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
  min-height: 44px;
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
  .mgChevron {
    transition: none;
  }
}
</style>
