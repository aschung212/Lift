<template>
  <div v-if="recovery.length > 0" class="mgChart">
    <p class="mgTitle">Recovery</p>
    <div class="mgBars" role="list" aria-label="Tag recovery status">
      <div
        v-for="item in recovery"
        :key="item.tag"
        class="mgRow"
        role="listitem"
        :aria-label="`${item.tag}: ${formatDaysAgo(item.daysSince)}, ${item.status === 'unknown' ? 'no recovery window set' : item.status}`"
      >
        <span class="mgLabel">{{ item.tag }}</span>
        <div class="mgBarTrack">
          <div
            v-if="item.recoveryDays !== null"
            class="mgBarFill"
            :class="'recBar--' + item.status"
            :style="{ width: barWidth(item) }"
          ></div>
        </div>
        <span class="mgCount recDaysText">{{ formatDaysAgo(item.daysSince) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TagRecovery } from '../composables/useTagRecovery'

defineProps<{
  recovery: TagRecovery[]
}>()

function formatDaysAgo(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return '1d'
  return `${days}d`
}

function barWidth(item: TagRecovery): string {
  if (item.recoveryDays === null) return '0%'
  const recoveryHours = item.recoveryDays * 24
  const pct = Math.min(item.hoursSince / recoveryHours, 1) * 100
  return `${pct}%`
}
</script>

<style scoped>
.recBar--recovered {
  background-color: var(--success);
}

.recBar--recovering {
  background-color: var(--accent);
}

.recBar--recent {
  background-color: var(--text-muted);
}

.recDaysText {
  width: 40px;
}

@media (prefers-reduced-motion: reduce) {
  .mgBarFill {
    transition: none;
  }
}
</style>
