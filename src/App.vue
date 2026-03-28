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
      <!-- Top bar -->
      <div class="topBar">
        <div class="topBarLeft">
          <button class="topBarBtn" @click="themeOpen = !themeOpen" title="Change theme" :aria-expanded="themeOpen">
            <span class="themeActiveDot" :style="{ background: THEMES.find(t => t.id === currentTheme)?.dot }"></span>
            <span class="topBarBtnLabel">Theme</span>
          </button>
          <!-- Theme picker dropdown -->
          <div v-if="themeOpen" class="themeDropdown">
            <button
              v-for="t in THEMES"
              :key="t.id"
              :class="['themeOption', { active: currentTheme === t.id }]"
              @click="currentTheme = t.id; themeOpen = false"
            >
              <span class="themeSwatchDot" :style="{ background: t.dot }"></span>
              {{ t.label }}
            </button>
          </div>
        </div>
        <button class="topBarBtn" @click="signOut">Sign out</button>
      </div>

      <WorkoutTracker />
      <BodyweightTracker />
    </div>
  </div>
</template>

<script setup>
import WorkoutTracker from './components/WorkoutTracker.vue'
import BodyweightTracker from './components/BodyweightTracker.vue'
import AuthScreen from './components/AuthScreen.vue'
import { ref } from 'vue'
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'

const { currentTheme, THEMES } = useTheme()
const { user, loading, signOut } = useAuth()
const themeOpen = ref(false)
</script>
