<template>
  <div id="appShell">
    <div class="appContainer">
      <!-- Theme switcher -->
      <nav class="themeSwitcher" aria-label="Color theme">
        <button
          v-for="t in THEMES"
          :key="t.id"
          :class="['themeBtn', { active: currentTheme === t.id }]"
          @click="currentTheme = t.id"
          :title="t.label"
        >
          <span class="themeSwatchDot" :style="{ background: t.dot }"></span>
          <span class="themeSwatchLabel">{{ t.label }}</span>
        </button>
      </nav>

      <WorkoutTracker />
    </div>
  </div>
</template>

<script setup>
import WorkoutTracker from './components/WorkoutTracker.vue'
import { useTheme } from './composables/useTheme'

const { currentTheme, THEMES } = useTheme()
</script>
