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
          <div class="topBarLeft" ref="themeDropdownEl">
            <button class="topBarBtn" @click="themeOpen = !themeOpen" title="Change theme" :aria-expanded="themeOpen">
              <span class="themeActiveDot" :style="{ background: THEMES.find(t => t.id === currentTheme)?.dot }"></span>
              <span class="topBarBtnLabel">Theme</span>
            </button>
            <div v-if="themeOpen" class="themeDropdown">
              <button
                v-for="t in THEMES"
                :key="t.id"
                :class="['themeOption', { active: currentTheme === t.id }]"
                @click="selectTheme(t.id)"
              >
                <span class="themeSwatchDot" :style="{ background: t.dot }"></span>
                {{ t.label }}
              </button>
              <div class="themeGlassRow">
                <span class="themeGlassLabel">Liquid Glass</span>
                <button :class="['glassToggle', { on: glassEnabled }]" @click="toggleGlass" :aria-label="glassEnabled ? 'Disable liquid glass' : 'Enable liquid glass'">
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
            </div>
          </div>

          <div class="topBarRight">
            <div ref="settingsDropdownEl">
              <button class="topBarBtn" @click="settingsOpen = !settingsOpen" title="Features" :aria-expanded="settingsOpen">
                <svg class="topBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
              <div v-if="settingsOpen" class="settingsDropdown">
                <div class="settingsHeader">Features</div>
                <div
                  v-for="tab in TAB_DEFS.filter(t => t.id !== 'workouts')"
                  :key="tab.id"
                  class="settingsRow"
                >
                  <span class="settingsLabel">{{ tab.label }}</span>
                  <button
                    :class="['glassToggle', { on: prefs.features[tab.id] }]"
                    @click="toggleFeature(tab.id)"
                    :disabled="prefs.features[tab.id] && prefs.enabledCount <= 1"
                    :aria-label="(prefs.features[tab.id] ? 'Disable ' : 'Enable ') + tab.label"
                  >
                    <span class="glassToggleThumb"></span>
                  </button>
                </div>
              </div>
            </div>
            <button class="topBarBtn" @click="confirmSignOut">Sign out</button>
          </div>
        </div>

        <div v-show="activeTab === 'workouts'" class="tabContent"><WorkoutTracker /></div>
        <div v-show="activeTab === 'calendar'" class="tabContent"><CalendarView /></div>
        <div v-show="activeTab === 'weight'" class="tabContent"><BodyweightTracker /></div>
      </div>

      <!-- Tab bar -->
      <nav class="tabBar">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          :class="['tabBtn', { active: activeTab === tab.id }]"
          @click="switchTab(tab.id)"
        >
          <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="tab.icon"></svg>
          <span class="tabLabel">{{ tab.label }}</span>
        </button>
      </nav>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import WorkoutTracker from './components/WorkoutTracker.vue'
import BodyweightTracker from './components/BodyweightTracker.vue'
import CalendarView from './components/CalendarView.vue'
import AuthScreen from './components/AuthScreen.vue'
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'
import { useAnalytics } from './composables/useAnalytics'
import { usePreferencesStore } from './stores/preferences'

const { currentTheme, THEMES, glassEnabled } = useTheme()
const { user, loading, signOut } = useAuth()
const { logEvent, tabSwitch, flushEngagement } = useAnalytics()
const prefs = usePreferencesStore()

const themeOpen = ref(false)
const settingsOpen = ref(false)
const activeTab = ref('workouts')
const themeDropdownEl = ref(null)
const settingsDropdownEl = ref(null)

// ── Tab definitions with inline SVG paths ────────────────────────
const TAB_DEFS = [
  {
    id: 'workouts',
    label: 'Workouts',
    icon: '<rect x="2" y="10" width="4" height="4" rx="1"/><rect x="18" y="10" width="4" height="4" rx="1"/><rect x="5" y="8" width="3" height="8" rx="1"/><rect x="16" y="8" width="3" height="8" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/>',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><circle cx="8" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'weight',
    label: 'Weight',
    icon: '<path d="M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M5 21h14"/><path d="M6 21l1.5-8h9L18 21"/><line x1="12" y1="9" x2="12" y2="13"/>',
  },
]

const visibleTabs = computed(() =>
  TAB_DEFS.filter(t => prefs.features[t.id])
)

// Fall back if active tab gets disabled
watch(() => prefs.features, () => {
  if (!prefs.features[activeTab.value]) {
    activeTab.value = visibleTabs.value[0]?.id || 'workouts'
  }
}, { deep: true })

// ── Analytics ────────────────────────────────────────────────────
function switchTab(tabId) {
  const from = activeTab.value
  activeTab.value = tabId
  tabSwitch(from, tabId)
}

function selectTheme(id) {
  currentTheme.value = id
  themeOpen.value = false
  logEvent('theme_change', { theme: id })
}

function toggleGlass() {
  glassEnabled.value = !glassEnabled.value
  logEvent('glass_toggle', { enabled: glassEnabled.value })
}

function confirmSignOut() {
  if (confirm('Sign out?')) {
    signOut()
  }
}

function toggleFeature(featureId) {
  prefs.toggleFeature(featureId)
  logEvent('feature_toggle', { feature: featureId, enabled: prefs.features[featureId] })
}

// Flush engagement timing on page unload
function onBeforeUnload() {
  flushEngagement()
}

// ── Click-outside handling ───────────────────────────────────────
function onClickOutside(e) {
  if (themeOpen.value && themeDropdownEl.value && !themeDropdownEl.value.contains(e.target)) {
    themeOpen.value = false
  }
  if (settingsOpen.value && settingsDropdownEl.value && !settingsDropdownEl.value.contains(e.target)) {
    settingsOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onClickOutside, true)
  window.addEventListener('beforeunload', onBeforeUnload)
  logEvent('session_start')
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onClickOutside, true)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>
