<template>
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="visible" class="unlockOverlay" @click.self="emit('close')">
        <div class="themeStatsSheet">
          <div class="themeStatsHeader">
            <span class="themeStatsTitle">{{ label }}</span>
            <button class="themeStatsClose" @click="emit('close')" aria-label="Close">&times;</button>
          </div>
          <template v-if="stats && stats.totalSets > 0">
            <div class="themeStatsGrid">
              <div class="themeStatItem">
                <span class="themeStatValue">{{ stats.totalSets }}</span>
                <span class="themeStatLabel">Sets</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ stats.totalReps.toLocaleString() }}</span>
                <span class="themeStatLabel">Reps</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ Math.round(stats.totalVolume).toLocaleString() }}</span>
                <span class="themeStatLabel">Volume (lbs)</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ stats.totalXP.toLocaleString() }}</span>
                <span class="themeStatLabel">XP Earned</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ stats.prCount }}</span>
                <span class="themeStatLabel">PRs</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ stats.daysUsed }}</span>
                <span class="themeStatLabel">Days</span>
              </div>
            </div>
            <div v-if="stats.favoriteExercise" class="themeStatRow">
              Favorite: <strong>{{ stats.favoriteExercise.name }}</strong> ({{ stats.favoriteExercise.sets }} sets)
            </div>
            <div class="themeStatRow">
              Avg XP per set: <strong>{{ stats.avgXPPerSet }}</strong>
            </div>
            <div v-if="stats.firstSetDate" class="themeStatRow themeStatMuted">
              {{ stats.firstSetDate.slice(0, 10) }} — {{ stats.lastSetDate?.slice(0, 10) }}
            </div>
          </template>
          <div v-else class="themeStatsEmpty">
            No training data with this theme yet. Log sets to build your stats.
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { ThemeStats } from '../lib/themeStats'

defineProps<{
  visible: boolean
  /** Display label of the theme whose stats are shown. */
  label: string
  /** Precomputed stats payload; null or zero sets renders the empty state. */
  stats: ThemeStats | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>
