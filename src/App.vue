<template>
  <div id="appShell">
    <!-- Loading state -->
    <div v-if="loading" class="authLoading">
      <div class="authLoadingDot"></div>
    </div>

    <!-- Auth screen -->
    <AuthScreen v-else-if="!user" />

    <!-- Authenticated app -->
    <template v-else>
      <div class="appContainer">
        <!-- Top bar -->
        <div class="topBar">
          <div class="topBarLeft">
            <button class="topBarBtn" @click="themeOpen = !themeOpen" title="Change theme" :aria-expanded="themeOpen">
              <span class="themeActiveDot" :style="{ background: THEMES.find(t => t.id === currentTheme)?.dot }"></span>
              <span class="topBarBtnLabel">Theme</span>
            </button>
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
              <div class="themeGlassRow">
                <span class="themeGlassLabel">Liquid Glass</span>
                <button :class="['glassToggle', { on: glassEnabled }]" @click="glassEnabled = !glassEnabled" :aria-label="glassEnabled ? 'Disable liquid glass' : 'Enable liquid glass'">
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
            </div>
          </div>
          <button class="topBarBtn" @click="signOut">Sign out</button>
        </div>

        <div v-show="activeTab === 'workouts'" class="tabContent"><WorkoutTracker /></div>
        <div v-show="activeTab === 'calendar'" class="tabContent"><CalendarView /></div>
        <div v-show="activeTab === 'weight'" class="tabContent"><BodyweightTracker /></div>
      </div>

      <!-- Tab bar -->
      <nav class="tabBar">
        <button :class="['tabBtn', { active: activeTab === 'workouts' }]" @click="activeTab = 'workouts'">
          <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="10" width="4" height="4" rx="1"/>
            <rect x="18" y="10" width="4" height="4" rx="1"/>
            <rect x="5" y="8" width="3" height="8" rx="1"/>
            <rect x="16" y="8" width="3" height="8" rx="1"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span class="tabLabel">Workouts</span>
        </button>

        <button :class="['tabBtn', { active: activeTab === 'calendar' }]" @click="activeTab = 'calendar'">
          <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/>
          </svg>
          <span class="tabLabel">Calendar</span>
        </button>

        <button :class="['tabBtn', { active: activeTab === 'weight' }]" @click="activeTab = 'weight'">
          <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
            <path d="M5 21h14"/>
            <path d="M6 21l1.5-8h9L18 21"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
          </svg>
          <span class="tabLabel">Weight</span>
        </button>
      </nav>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import WorkoutTracker from './components/WorkoutTracker.vue'
import BodyweightTracker from './components/BodyweightTracker.vue'
import CalendarView from './components/CalendarView.vue'
import AuthScreen from './components/AuthScreen.vue'
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'

const { currentTheme, THEMES, glassEnabled } = useTheme()
const { user, loading, signOut } = useAuth()
const themeOpen = ref(false)
const activeTab = ref('workouts')
</script>
