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
          <component
            :is="isExpandable(item.tag) ? 'button' : 'div'"
            class="mgRowMain"
            :class="{ mgRowMainTappable: isExpandable(item.tag) }"
            :type="isExpandable(item.tag) ? 'button' : undefined"
            :aria-expanded="isExpandable(item.tag) ? (expandedTag === item.tag) : undefined"
            :aria-label="isExpandable(item.tag) ? `${item.tag}: ${item.sets} sets. ${expandedTag === item.tag ? 'Hide' : 'Show'} weekly volume trend` : undefined"
            @click="isExpandable(item.tag) && toggleTag(item.tag)"
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
            <svg
              v-if="isExpandable(item.tag)"
              class="mgRowChevron"
              :class="{ mgRowChevronOpen: expandedTag === item.tag }"
              viewBox="0 0 24 24" width="14" height="14" fill="none"
              stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true"
            ><polyline points="6 9 12 15 18 9"/></svg>
          </component>
          <TagVolumeSparkline
            v-if="expandedTag === item.tag && tagTrends"
            :series="tagTrends[item.tag]"
            :tag="item.tag"
          />
        </div>
      </div>

      <p class="mgTotal">{{ totalSets }} sets this week</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import TagVolumeSparkline from './TagVolumeSparkline.vue'
import type { TagVolume } from '../composables/useTagVolume'
import type { TimeSeriesEntry } from '../composables/useSVGTimeSeries'

const props = defineProps<{
  weeklyVolume: TagVolume[]
  maxSets: number
  totalSets: number
  collapsed?: boolean
  /** Per-tag weekly volume history. When a tag has ≥2 weeks, its row becomes
   *  tappable to reveal an inline trend sparkline. */
  tagTrends?: Record<string, TimeSeriesEntry[]>
}>()

defineEmits<{
  toggleCollapsed: []
}>()

// Only one tag's trend is open at a time (progressive disclosure).
const expandedTag = ref<string | null>(null)

function isExpandable(tag: string): boolean {
  return (props.tagTrends?.[tag]?.length ?? 0) >= 2
}

function toggleTag(tag: string) {
  expandedTag.value = expandedTag.value === tag ? null : tag
}
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
  flex-direction: column;
  min-height: 44px;
}

.mgRowMain {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0;
  margin: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
}

.mgRowMainTappable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.mgRowMainTappable:active {
  opacity: 0.6;
}

.mgRowChevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.2s;
}

.mgRowChevronOpen {
  transform: rotate(180deg);
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
  .mgChevron,
  .mgRowChevron {
    transition: none;
  }
}
</style>
