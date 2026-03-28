<template>
  <div id="appShell">
    <!-- Loading state -->
    <div v-if="loading" class="authLoading">
      <div class="authLoadingDot"></div>
    </div>

    <!-- Auth screen -->
    <AuthScreen v-else-if="!user" />

    <!-- Authenticated app -->
    <div v-else class="appContainer">
      <!-- Theme switcher + sign out -->
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
        <button class="themeBtn" @click="signOut" title="Sign out">
          <span class="themeSwatchLabel">Sign out</span>
        </button>
      </nav>

      <WorkoutTracker />
      <BodyweightTracker />
    </div>
  </div>
</template>

<script setup>
import WorkoutTracker from './components/WorkoutTracker.vue'
import BodyweightTracker from './components/BodyweightTracker.vue'
import AuthScreen from './components/AuthScreen.vue'
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'

const { currentTheme, THEMES } = useTheme()
const { user, loading, signOut } = useAuth()
</script>
