<template>
  <div v-if="recovery.length > 0" class="recCard">
    <p class="recTitle">Recovery</p>
    <div class="recRows" role="list" aria-label="Tag recovery status">
      <div
        v-for="item in recovery"
        :key="item.tag"
        class="recRow"
        role="listitem"
        :aria-label="`${item.tag}: ${formatDaysAgo(item.daysSince)}, ${item.status === 'unknown' ? 'no recovery window set' : item.status}`"
      >
        <span
          class="recTag"
          :style="{ borderColor: getTagColor(item.tag).border, background: getTagColor(item.tag).bg }"
        >{{ item.tag }}</span>
        <div v-if="item.recoveryDays !== null" class="recBarTrack">
          <div
            class="recBarFill"
            :class="'recBar--' + item.status"
            :style="{ width: barWidth(item) }"
          ></div>
        </div>
        <div v-else class="recBarTrack recBarTrackEmpty"></div>
        <span class="recDays">{{ formatDaysAgo(item.daysSince) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TagRecovery } from '../composables/useTagRecovery'
import { getTagColor } from '../lib/tagColors'

defineProps<{
  recovery: TagRecovery[]
}>()

function formatDaysAgo(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function barWidth(item: TagRecovery): string {
  if (item.recoveryDays === null) return '0%'
  const recoveryHours = item.recoveryDays * 24
  const pct = Math.min(item.hoursSince / recoveryHours, 1) * 100
  return `${pct}%`
}
</script>

<style scoped>
.recCard {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border);
}

.recTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.recRows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}

.recTag {
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 56px;
  text-align: center;
  color: var(--text-primary);
}

.recBarTrack {
  flex: 1;
  height: 16px;
  background: var(--bg-elevated);
  border-radius: 8px;
  overflow: hidden;
}

.recBarTrackEmpty {
  opacity: 0.4;
}

.recBarFill {
  height: 100%;
  border-radius: 8px;
  min-width: 4px;
  transition: width 0.3s ease;
}

.recBar--recovered {
  background-color: var(--success);
}

.recBar--recovering {
  background-color: var(--accent);
}

.recBar--recent {
  background-color: var(--text-muted);
}

.recDays {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  width: 64px;
  text-align: right;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .recBarFill {
    transition: none;
  }
}
</style>
