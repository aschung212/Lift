<template>
  <div id="appShell">
    <!-- Loading state -->
    <div v-if="loading" class="authLoading">
      <div class="authLoadingDot"></div>
    </div>

    <!-- Auth screen -->
    <AuthScreen v-else-if="!user" />

    <!-- Onboarding -->
    <OnboardingScreen v-else-if="showOnboarding" @complete="onOnboardingComplete" />

    <!-- Authenticated app -->
    <template v-else>
      <main class="appContainer">
        <button v-if="hasSampleData" class="sampleBanner" @click="clearSampleData">
          Viewing sample data — Tap to clear and start fresh
        </button>
        <div v-show="activeTab === 'workouts'" class="tabContent"><WorkoutTracker /></div>
        <div v-show="activeTab === 'calendar'" class="tabContent"><CalendarView /></div>
        <div v-show="activeTab === 'weight'" class="tabContent"><BodyweightTracker /></div>
      </main>

      <!-- Tab bar -->
      <nav class="tabBar" aria-label="Main navigation">
        <div class="tabBarTabs" role="tablist">
          <div
            class="tabIndicator"
            :style="tabIndicatorStyle"
            aria-hidden="true"
          ></div>
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :class="['tabBtn', { active: activeTab === tab.id }]"
            @click="switchTab(tab.id)"
          >
            <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="tab.icon"></svg>
            <span class="tabLabel">{{ tab.label }}</span>
          </button>
        </div>
        <button
          :class="['tabBtn tabBtnSettings', { active: settingsOpen }]"
          @click="settingsOpen ? closeSettings() : (settingsOpen = true)"
          title="Settings"
        >
          <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span class="tabLabel">Settings</span>
        </button>
      </nav>

      <!-- Settings bottom sheet -->
      <Teleport to="body">
        <div v-if="settingsOpen" class="settingsOverlay" @click.self="closeSettings" @keydown.escape="closeSettings">
          <div class="settingsSheet" ref="settingsEl" role="dialog" aria-modal="true" aria-labelledby="settings-title">

            <div class="settingsGroup">
              <div class="settingsHeader" id="settings-title">Appearance</div>
              <div class="settingsThemeGrid">
                <button
                  v-for="t in THEMES"
                  :key="t.id"
                  :class="['themePreview', { active: currentTheme === t.id }]"
                  @click="selectTheme(t.id)"
                >
                  <span
                    class="themePreviewDot"
                    :style="{
                      background: 'linear-gradient(135deg, ' + THEME_PREVIEWS[t.id]?.[resolvedMode]?.accent + ', ' + THEME_PREVIEWS[t.id]?.[resolvedMode]?.bg + ')',
                    }"
                  ></span>
                  <span class="themePreviewLabel">{{ t.label }}</span>
                </button>
              </div>
              <div class="settingsRow">
                <span class="settingsLabel">Mode</span>
                <div class="modeSegmented">
                  <button
                    v-for="m in ['light', 'auto', 'dark']"
                    :key="m"
                    :class="['modeSegBtn', { active: colorMode === m }]"
                    @click="setMode(m)"
                  >{{ m[0].toUpperCase() + m.slice(1) }}</button>
                </div>
              </div>
              <div class="settingsRow">
                <span class="settingsLabel">Liquid Glass</span>
                <button :class="['glassToggle', { on: glassEnabled }]" @click="toggleGlass" role="switch" :aria-checked="glassEnabled" :aria-label="glassEnabled ? 'Disable liquid glass' : 'Enable liquid glass'">
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
              <div class="settingsRow">
                <span class="settingsLabel">Units</span>
                <div class="modeSegmented">
                  <button :class="['modeSegBtn', { active: weightUnit === 'lbs' }]" @click="weightUnit = 'lbs'">lbs</button>
                  <button :class="['modeSegBtn', { active: weightUnit === 'kg' }]" @click="weightUnit = 'kg'">kg</button>
                </div>
              </div>
            </div>

            <div class="settingsGroup">
              <div class="settingsHeader">Features</div>
              <div
                v-for="tab in TAB_DEFS"
                :key="tab.id"
                class="settingsRow"
              >
                <span class="settingsLabel">{{ tab.label }}</span>
                <button
                  :class="['glassToggle', { on: prefs.features[tab.id] }]"
                  @click="toggleFeature(tab.id)"
                  :disabled="prefs.features[tab.id] && prefs.enabledCount <= 1"
                  role="switch"
                  :aria-checked="prefs.features[tab.id]"
                  :aria-label="(prefs.features[tab.id] ? 'Disable ' : 'Enable ') + tab.label"
                >
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
              <div class="settingsRow">
                <span class="settingsLabel">Rest Timer</span>
                <button
                  :class="['glassToggle', { on: restTimerEnabled }]"
                  @click="restTimerEnabled = !restTimerEnabled"
                  role="switch"
                  :aria-checked="restTimerEnabled"
                  :aria-label="restTimerEnabled ? 'Disable rest timer' : 'Enable rest timer'"
                >
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
            </div>

            <div class="settingsGroup">
              <button class="settingsSignOut" @click="confirmSignOut">Sign Out</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import WorkoutTracker from './components/WorkoutTracker.vue'
import BodyweightTracker from './components/BodyweightTracker.vue'
import CalendarView from './components/CalendarView.vue'
import AuthScreen from './components/AuthScreen.vue'
import OnboardingScreen from './components/OnboardingScreen.vue'
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'
import { useAnalytics } from './composables/useAnalytics'
import { usePreferencesStore } from './stores/preferences'
import { useWorkoutStore } from './stores/workout'
import { useBodyweightStore } from './stores/bodyweight'

const { currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode, glassEnabled, restTimerEnabled, weightUnit } = useTheme()
const { user, loading, signOut } = useAuth()
const { logEvent, tabSwitch, flushEngagement } = useAnalytics()
const prefs = usePreferencesStore()

const settingsOpen = ref(false)
const settingsEl = ref(null)

// ── Onboarding ──────────────────────────────────────────────────
const onboardingComplete = ref(!!localStorage.getItem('onboarding-complete'))
const showOnboarding = computed(() => !onboardingComplete.value)
const hasSampleData = ref(localStorage.getItem('sample-data') === 'true')

function onOnboardingComplete() {
  onboardingComplete.value = true
  hasSampleData.value = localStorage.getItem('sample-data') === 'true'
}

function clearSampleData() {
  const workoutStore = useWorkoutStore()
  const bwStore = useBodyweightStore()
  // Clear all exercises and bodyweight entries
  const exerciseIds = [...workoutStore.exercises.map(e => e.id)]
  for (const id of exerciseIds) {
    workoutStore.deleteExercise(id)
  }
  bwStore.clearAll()
  localStorage.removeItem('sample-data')
  hasSampleData.value = false
}

function closeSettings() {
  if (!settingsOpen.value) return
  const el = settingsEl.value
  if (!el) { settingsOpen.value = false; return }
  el.classList.add('settingsSheetClosing')
  el.addEventListener('animationend', () => {
    settingsOpen.value = false
  }, { once: true })
}
const activeTab = ref(localStorage.getItem('active-tab') || 'workouts')

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

const tabIndicatorStyle = computed(() => {
  const idx = visibleTabs.value.findIndex(t => t.id === activeTab.value)
  const count = visibleTabs.value.length
  if (idx < 0 || count === 0) return { opacity: 0 }
  const widthPct = 100 / count
  return {
    width: `calc(${widthPct}% - 8px)`,
    left: `calc(${widthPct * idx}% + 4px)`,
  }
})

// Fall back if active tab gets disabled
watch(() => prefs.features, () => {
  if (!prefs.features[activeTab.value]) {
    activeTab.value = visibleTabs.value[0]?.id || 'workouts'
  }
}, { deep: true })

// ── Analytics ────────────────────────────────────────────────────
function switchTab(tabId) {
  const from = activeTab.value
  closeSettings()
  if (from === tabId) return
  activeTab.value = tabId
  localStorage.setItem('active-tab', tabId)
  tabSwitch(from, tabId)
}

function selectTheme(id) {
  currentTheme.value = id
  logEvent('theme_change', { theme: id })
}

function setMode(mode) {
  colorMode.value = mode
  logEvent('mode_toggle', { mode })
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

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  logEvent('session_start')
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>
