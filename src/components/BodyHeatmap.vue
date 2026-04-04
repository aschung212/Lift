<template>
  <div class="heatmapWrap">
    <div class="heatmapToggle" role="tablist" aria-label="Body view">
      <button
        role="tab"
        class="heatmapTab"
        :class="{ active: view === 'front' }"
        :aria-selected="view === 'front'"
        @click="view = 'front'"
      >Front</button>
      <button
        role="tab"
        class="heatmapTab"
        :class="{ active: view === 'back' }"
        :aria-selected="view === 'back'"
        @click="view = 'back'"
      >Back</button>
    </div>

    <div class="heatmapBody" :aria-label="`${view} body view showing muscle group training volume`">
      <svg
        viewBox="0 0 200 400"
        xmlns="http://www.w3.org/2000/svg"
        class="heatmapSvg"
        role="img"
        :aria-label="`${view} body heatmap`"
      >
        <!-- Body outline (always visible, subtle) -->
        <g class="bodyOutline">
          <!-- Head -->
          <ellipse cx="100" cy="38" rx="22" ry="26" />
          <!-- Neck -->
          <rect x="90" y="62" width="20" height="14" rx="4" />
          <!-- Torso -->
          <path d="M66,76 Q60,76 58,82 L52,148 Q50,170 60,186 L68,196 Q80,206 100,208 Q120,206 132,196 L140,186 Q150,170 148,148 L142,82 Q140,76 134,76 Z" />
          <!-- Left upper arm -->
          <path d="M58,82 Q48,84 44,96 L38,136 Q36,144 42,148 L48,148 Q54,148 54,140 L58,104 Z" />
          <!-- Right upper arm -->
          <path d="M142,82 Q152,84 156,96 L162,136 Q164,144 158,148 L152,148 Q146,148 146,140 L142,104 Z" />
          <!-- Left forearm -->
          <path d="M38,148 L32,200 Q30,210 34,214 L40,214 Q46,210 44,200 L48,148 Z" />
          <!-- Right forearm -->
          <path d="M162,148 L168,200 Q170,210 166,214 L160,214 Q154,210 156,200 L152,148 Z" />
          <!-- Left leg -->
          <path d="M68,196 Q64,200 62,210 L56,296 Q54,310 58,320 L62,332 Q64,340 66,350 L64,370 Q62,382 66,388 L76,388 Q80,382 78,370 L80,332 Q82,316 84,310 L88,260 Q90,240 92,208 Z" />
          <!-- Right leg -->
          <path d="M132,196 Q136,200 138,210 L144,296 Q146,310 142,320 L138,332 Q136,340 134,350 L136,370 Q138,382 134,388 L124,388 Q120,382 122,370 L120,332 Q118,316 116,310 L112,260 Q110,240 108,208 Z" />
        </g>

        <!-- Muscle group regions (colored by volume) -->
        <g v-if="view === 'front'" class="muscleRegions">
          <!-- Chest -->
          <path
            d="M72,86 Q76,82 88,80 L100,82 L112,80 Q124,82 128,86 L130,102 Q126,114 112,118 L100,120 L88,118 Q74,114 70,102 Z"
            :style="regionStyle('Chest')"
            class="muscleRegion"
            role="img"
            :aria-label="`Chest: ${getSetCount('Chest')} sets`"
          />
          <!-- Left Shoulder -->
          <path
            d="M58,82 Q52,78 48,84 L44,96 L52,100 L58,98 Z"
            :style="regionStyle('Shoulders')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left shoulder: ${getSetCount('Shoulders')} sets`"
          />
          <!-- Right Shoulder -->
          <path
            d="M142,82 Q148,78 152,84 L156,96 L148,100 L142,98 Z"
            :style="regionStyle('Shoulders')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right shoulder: ${getSetCount('Shoulders')} sets`"
          />
          <!-- Left Bicep -->
          <path
            d="M48,100 L44,96 L38,136 Q38,142 42,144 L48,144 Q52,142 52,136 L54,108 Z"
            :style="regionStyle('Biceps')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left bicep: ${getSetCount('Biceps')} sets`"
          />
          <!-- Right Bicep -->
          <path
            d="M152,100 L156,96 L162,136 Q162,142 158,144 L152,144 Q148,142 148,136 L146,108 Z"
            :style="regionStyle('Biceps')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right bicep: ${getSetCount('Biceps')} sets`"
          />
          <!-- Core / Abs -->
          <path
            d="M82,120 Q80,122 78,130 L74,160 Q72,176 76,188 L80,196 Q88,204 100,206 Q112,204 120,196 L124,188 Q128,176 126,160 L122,130 Q120,122 118,120 Z"
            :style="regionStyle('Core')"
            class="muscleRegion"
            role="img"
            :aria-label="`Core: ${getSetCount('Core')} sets`"
          />
          <!-- Left Quad -->
          <path
            d="M68,200 Q66,204 64,216 L58,290 Q60,296 66,296 L82,296 Q86,290 86,280 L88,240 Q90,220 90,210 Z"
            :style="regionStyle('Legs')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left quad: ${getSetCount('Legs')} sets`"
          />
          <!-- Right Quad -->
          <path
            d="M132,200 Q134,204 136,216 L142,290 Q140,296 134,296 L118,296 Q114,290 114,280 L112,240 Q110,220 110,210 Z"
            :style="regionStyle('Legs')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right quad: ${getSetCount('Legs')} sets`"
          />
        </g>

        <g v-else class="muscleRegions">
          <!-- Back / Upper back -->
          <path
            d="M72,86 Q76,82 88,80 L100,82 L112,80 Q124,82 128,86 L130,110 Q126,128 112,132 L100,134 L88,132 Q74,128 70,110 Z"
            :style="regionStyle('Back')"
            class="muscleRegion"
            role="img"
            :aria-label="`Back: ${getSetCount('Back')} sets`"
          />
          <!-- Back / Lower back -->
          <path
            d="M78,132 Q76,134 74,142 L72,164 Q70,178 76,190 L80,198 Q88,206 100,208 Q112,206 120,198 L124,190 Q130,178 128,164 L126,142 Q124,134 122,132 Z"
            :style="regionStyle('Back')"
            class="muscleRegion"
            role="img"
            :aria-label="`Lower back: ${getSetCount('Back')} sets`"
          />
          <!-- Left Rear Shoulder -->
          <path
            d="M58,82 Q52,78 48,84 L44,96 L52,100 L58,98 Z"
            :style="regionStyle('Shoulders')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left shoulder: ${getSetCount('Shoulders')} sets`"
          />
          <!-- Right Rear Shoulder -->
          <path
            d="M142,82 Q148,78 152,84 L156,96 L148,100 L142,98 Z"
            :style="regionStyle('Shoulders')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right shoulder: ${getSetCount('Shoulders')} sets`"
          />
          <!-- Left Tricep -->
          <path
            d="M48,100 L44,96 L38,136 Q38,142 42,144 L48,144 Q52,142 52,136 L54,108 Z"
            :style="regionStyle('Triceps')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left tricep: ${getSetCount('Triceps')} sets`"
          />
          <!-- Right Tricep -->
          <path
            d="M152,100 L156,96 L162,136 Q162,142 158,144 L152,144 Q148,142 148,136 L146,108 Z"
            :style="regionStyle('Triceps')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right tricep: ${getSetCount('Triceps')} sets`"
          />
          <!-- Left Hamstring / Glute -->
          <path
            d="M68,200 Q66,204 64,216 L58,290 Q60,296 66,296 L82,296 Q86,290 86,280 L88,240 Q90,220 90,210 Z"
            :style="regionStyle('Legs')"
            class="muscleRegion"
            role="img"
            :aria-label="`Left hamstring: ${getSetCount('Legs')} sets`"
          />
          <!-- Right Hamstring / Glute -->
          <path
            d="M132,200 Q134,204 136,216 L142,290 Q140,296 134,296 L118,296 Q114,290 114,280 L112,240 Q110,220 110,210 Z"
            :style="regionStyle('Legs')"
            class="muscleRegion"
            role="img"
            :aria-label="`Right hamstring: ${getSetCount('Legs')} sets`"
          />
        </g>
      </svg>

      <!-- Legend -->
      <div class="heatmapLegend" aria-hidden="true">
        <span class="legendLabel">Low</span>
        <div class="legendBar"></div>
        <span class="legendLabel">High</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { MuscleGroup } from '../lib/muscleGroups'
import type { MuscleGroupSets } from '../composables/useMuscleGroupVolume'

const props = defineProps<{
  weeklyVolume: MuscleGroupSets[]
  maxSets: number
}>()

const view = ref<'front' | 'back'>('front')

function getSetCount(group: MuscleGroup): number {
  const item = props.weeklyVolume.find(v => v.group === group)
  return item?.sets ?? 0
}

function regionStyle(group: MuscleGroup): Record<string, string> {
  const sets = getSetCount(group)
  if (sets === 0 || props.maxSets === 0) {
    return { fillOpacity: '0' }
  }
  // Scale from 0.15 (low volume) to 0.85 (max volume)
  const ratio = sets / props.maxSets
  const opacity = 0.15 + ratio * 0.70
  return { fillOpacity: String(opacity) }
}
</script>

<style scoped>
.heatmapWrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.heatmapToggle {
  display: flex;
  gap: 0;
  background: var(--bg-elevated);
  border-radius: 8px;
  padding: 2px;
  border: 1px solid var(--border);
}

.heatmapTab {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  padding: 6px 16px;
  min-height: 32px;
  min-width: 64px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  -webkit-tap-highlight-color: transparent;
}

.heatmapTab.active {
  background: var(--accent);
  color: var(--text-on-accent);
}

.heatmapBody {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.heatmapSvg {
  width: 140px;
  height: 280px;
}

.bodyOutline ellipse,
.bodyOutline rect,
.bodyOutline path {
  fill: var(--bg-elevated);
  stroke: var(--border);
  stroke-width: 1;
}

.muscleRegion {
  fill: var(--accent);
  stroke: none;
  transition: fill-opacity 0.3s ease;
  pointer-events: none;
}

.heatmapLegend {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legendLabel {
  font-size: 10px;
  color: var(--text-muted);
}

.legendBar {
  width: 80px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--accent-subtle), var(--accent));
}

@media (prefers-reduced-motion: reduce) {
  .muscleRegion {
    transition: none;
  }
  .heatmapTab {
    transition: none;
  }
}
</style>
