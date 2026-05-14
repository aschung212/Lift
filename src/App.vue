<template>
  <ErrorBoundary>
  <div id="appShell">
    <!-- Nothing renders while loading — splash screen covers this -->
    <template v-if="!loading">

    <!-- Auth screen -->
    <AuthScreen v-if="!user" />

    <!-- Onboarding -->
    <OnboardingScreen v-else-if="showOnboarding" @complete="onOnboardingComplete" @started="onboardingInProgress = true" />

    <!-- Authenticated app -->
    <template v-else>
      <a href="#main-content" class="srOnly srOnlyFocusable">Skip to content</a>
      <main class="appContainer">
        <div v-if="isPreviewDeploy" class="previewBanner" role="status">
          <template v-if="isPreviewMode">
            Preview mode — changes stay local
            <button class="previewToggle" @click="isPreviewMode = false">Enable writes</button>
          </template>
          <template v-else>
            ⚠ Live writes enabled — changes sync to Supabase
            <button class="previewToggle" @click="isPreviewMode = true">Go read-only</button>
          </template>
        </div>
        <button v-if="hasSampleData" class="sampleBanner" @click="clearSampleData">
          Viewing sample data — Tap to clear and start fresh
        </button>

        <!-- PWA install banner -->
        <Transition name="installBanner">
          <div v-if="installBannerVisible" class="installBanner" role="banner">
            <div class="installBannerContent">
              <div class="installBannerText">
                <strong class="installBannerTitle">Install Lift</strong>
                <span v-if="isIOSPrompt" class="installBannerDesc">
                  Tap
                  <svg class="installBannerShareIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share icon"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  then "Add to Home Screen"
                </span>
                <span v-else class="installBannerDesc">Add to your home screen for the full experience</span>
              </div>
              <div class="installBannerActions">
                <button v-if="!isIOSPrompt" class="installBannerBtn installBannerInstall" @click="triggerInstall">Install</button>
                <button class="installBannerBtn installBannerDismiss" @click="dismissInstallBanner" aria-label="Dismiss install banner">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
          </div>
        </Transition>

        <div class="appTopBar">
          <div class="appTopBarLeft">
            <button
              class="settingsGearBtn"
              @click="settingsOpen ? closeSettings() : (settingsOpen = true)"
              title="Settings"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <span v-if="syncStatus !== 'synced'" class="syncIndicator" :class="'syncIndicator--' + syncStatus" :title="syncStatusLabel" role="status">
              <svg v-if="syncStatus === 'error'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <svg v-else-if="syncStatus === 'offline'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
            </span>
          </div>
          <div class="appTopBarRight">
            <button
              v-if="activeTab === 'workouts'"
              class="topBarPlusBtn"
              @click="triggerQuickLog"
              title="Log a set"
              aria-label="Log a set"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>
        <div id="main-content" ref="tabContentEl" class="tabContent" tabindex="-1">
          <KeepAlive>
            <WorkoutTracker v-if="activeTab === 'workouts'" ref="workoutTrackerRef" />
            <CalendarView v-else-if="activeTab === 'calendar'" />
            <BodyweightTracker v-else-if="activeTab === 'weight'" />
          </KeepAlive>
        </div>
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
            <!-- eslint-disable-next-line vue/no-v-html, vue/html-self-closing -- icons are hardcoded SVG paths, not user input -->
            <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="tab.icon"></svg>
            <span class="tabLabel">{{ tab.label }}</span>
          </button>
        </div>
      </nav>

      <!-- Settings sheet (extracted component) -->
      <SettingsSheet v-if="settingsOpen" ref="settingsSheetRef" @close="settingsOpen = false" @sign-out="handleSettingsSignOut" />
    </template>

    <!-- Undo toast -->
    <Teleport to="body">
      <Transition name="undoToast">
        <div v-if="undoToast" class="undoToastBar" role="status" aria-live="polite">
          <span class="undoToastMsg">{{ undoToast.message }}</span>
          <button class="undoToastBtn" @click="performUndo">Undo</button>
        </div>
      </Transition>
    </Teleport>

    <!-- Keyboard shortcuts help -->
    <Teleport to="body">
      <Transition name="undoToast">
        <div v-if="shortcutsOpen" class="kbOverlay" @click.self="closeShortcuts" @keydown.escape="closeShortcuts">
          <div class="kbSheet" role="dialog" aria-modal="true" aria-labelledby="kb-title">
            <h3 id="kb-title" class="kbTitle">Keyboard Shortcuts</h3>
            <dl class="kbList">
              <div class="kbRow"><dt class="kbKey"><kbd>?</kbd></dt><dd class="kbDesc">Show this help</dd></div>
              <div class="kbRow"><dt class="kbKey"><kbd>1</kbd></dt><dd class="kbDesc">Go to Workouts</dd></div>
              <div class="kbRow"><dt class="kbKey"><kbd>2</kbd></dt><dd class="kbDesc">Go to Calendar</dd></div>
              <div class="kbRow"><dt class="kbKey"><kbd>3</kbd></dt><dd class="kbDesc">Go to Weight</dd></div>
              <div class="kbRow"><dt class="kbKey"><kbd>,</kbd></dt><dd class="kbDesc">Open settings</dd></div>
              <div class="kbRow"><dt class="kbKey"><kbd>Esc</kbd></dt><dd class="kbDesc">Close panel</dd></div>
            </dl>
            <button class="kbClose" @click="closeShortcuts">Close</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    </template>
  </div>
  </ErrorBoundary>

  <!-- Global XP toast -->
  <Teleport to="body">
    <transition name="xpGlobalFade">
      <div v-if="xpToast.visible" class="xpGlobalToast" role="status" aria-live="polite">
        <div class="xpToastEarned">{{ xpToast.text }}</div>
        <div class="xpToastTotal">{{ xpToast.nextThresholdXP ? `${xpToast.totalXP.toLocaleString()} / ${xpToast.nextThresholdXP.toLocaleString()} XP` : `${xpToast.totalXP.toLocaleString()} XP` }}</div>
        <div v-if="xpToast.nextThresholdXP" class="xpToastProgress">
          <div class="xpToastProgressFill" :style="{ width: xpToast.progressPercent + '%' }"></div>
        </div>
      </div>
    </transition>
  </Teleport>


  <!-- Theme unlock celebration -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="unlockCelebration.visible" class="unlockOverlay" @click.self="dismissUnlockCelebration">
        <div class="unlockModal" role="alert" aria-live="assertive">
          <div class="unlockIcon">
            <span
              class="unlockDot"
              :style="unlockCelebration.themeId ? {
                background: 'linear-gradient(135deg, ' + THEME_PREVIEWS[unlockCelebration.themeId]?.[resolvedMode]?.accent + ', ' + THEME_PREVIEWS[unlockCelebration.themeId]?.[resolvedMode]?.bg + ')',
              } : {}"
            ></span>
          </div>
          <div class="unlockTitle">{{ progressionStore.showProgression ? 'Theme Unlocked!' : 'New Theme Available!' }}</div>
          <div class="unlockThemeName">{{ unlockCelebration.themeName }}</div>
          <button class="unlockDismiss" @click="dismissUnlockCelebration">Nice!</button>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Full-screen PR celebration — triggered via usePRBurst().presentPRBurst(). -->
  <Teleport to="body">
    <PRBurst />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { isPreviewDeploy, isPreviewMode, initSupabase } from './lib/supabase'
import ErrorBoundary from './components/ErrorBoundary.vue'
import AuthScreen from './components/AuthScreen.vue'
import OnboardingScreen from './components/OnboardingScreen.vue'
import SettingsSheet from './components/SettingsSheet.vue'
import PRBurst from './components/PRBurst.vue'

// Lazy-load tab content — split into separate chunks for faster initial load
import SkeletonLoader from './components/SkeletonLoader.vue'
const WorkoutTracker = defineAsyncComponent({
  loader: () => import('./components/WorkoutTracker.vue'),
  loadingComponent: SkeletonLoader,
  delay: 100,
})
const CalendarView = defineAsyncComponent({
  loader: () => import('./components/CalendarView.vue'),
  loadingComponent: SkeletonLoader,
  delay: 100,
})
const BodyweightTracker = defineAsyncComponent({
  loader: () => import('./components/BodyweightTracker.vue'),
  loadingComponent: SkeletonLoader,
  delay: 100,
})
import { useTheme, connectProgressionStore } from './composables/useTheme'
import type { ThemeId } from './lib/themes'
import { useProgressionStore, xpToast, unlockCelebration, dismissUnlockCelebration, showXPToast } from './stores/progression'
import { isMigrated, markMigrated, computeRetroactiveXP } from './lib/xpMigration'
import { requestPersistentStorage, ensureLocalStorage } from './lib/durableStorage'
import { useAuth } from './composables/useAuth'
import { useAnalytics } from './composables/useAnalytics'
import { usePreferencesStore } from './stores/preferences'
import { useWorkoutStore } from './stores/workout'
import { syncStatus } from './lib/syncQueue'
import { useBodyweightStore } from './stores/bodyweight'
import { useUndoToast } from './composables/useUndoToast'
import { useFocusTrap } from './composables/useFocusTrap'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useInstallPrompt } from './composables/useInstallPrompt'
import { useXPCeremony } from './composables/useXPCeremony'
import { registerSW } from 'virtual:pwa-register'
import { onCrossTabMessage, type StoreKey } from './lib/crossTabSync'

const { currentTheme, THEME_PREVIEWS, resolvedMode, isThemeUnlocked } = useTheme()
const progressionStore = useProgressionStore()
connectProgressionStore(() => progressionStore)
const { celebrateUnlocks } = useXPCeremony()

const { user, loading, init: initAuth, signOut } = useAuth()
const { logEvent, tabSwitch, flushEngagement } = useAnalytics()
const prefs = usePreferencesStore()
const { toast: undoToast, performUndo } = useUndoToast()

// ── PWA install prompt ──────────────────────────────────────────
const workoutStoreForInstall = useWorkoutStore()
const installWorkoutDays = computed(() => workoutStoreForInstall.workoutDates.length)
const { showBanner: installBannerVisible, isIOSPrompt, dismiss: dismissInstallBanner, install: triggerInstall } = useInstallPrompt(installWorkoutDays)

// Dismiss splash screen once auth resolves
watch(loading, (isLoading) => {
  if (!isLoading) {
    const splash = document.getElementById('splash')
    if (splash) {
      splash.classList.add('fade-out')
      splash.addEventListener('transitionend', () => splash.remove())
    }
  }
}, { immediate: true })

const syncStatusLabel = computed(() => {
  if (syncStatus.value === 'syncing') return 'Syncing...'
  if (syncStatus.value === 'error') return 'Sync failed — changes saved locally'
  if (syncStatus.value === 'offline') return 'Offline — changes saved locally'
  return ''
})

// Detect offline/online
function updateOnlineStatus() {
  if (!navigator.onLine) syncStatus.value = 'offline'
  else if (syncStatus.value === 'offline') syncStatus.value = 'synced'
}
window.addEventListener('online', updateOnlineStatus)
window.addEventListener('offline', updateOnlineStatus)
if (!navigator.onLine) syncStatus.value = 'offline'

const settingsOpen = ref(false)
const settingsSheetRef = ref<InstanceType<typeof SettingsSheet> | null>(null)

// ── Focus trap for keyboard shortcuts modal ───────────────────
const shortcutsFocus = useFocusTrap()

// ── Service worker auto-update ──────────────────────────────────
let swRegistration: ServiceWorkerRegistration | undefined
registerSW({
  onRegisteredSW(_url, registration) {
    swRegistration = registration ?? undefined
    // Poll for updates every 10 minutes
    setInterval(() => registration?.update(), 10 * 60 * 1000)
  },
  onOfflineReady() { /* SW installed, app works offline */ },
})

// Check for SW update on visibility change (tab switch back, app resume)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') swRegistration?.update()
})

// Expose a function components can call after meaningful user actions
function checkForSWUpdate() { swRegistration?.update() }

// Listen for the controlling SW changing — means auto-update activated.
// On first visit currentController is null; skip reload to avoid a surprise refresh.
// On subsequent changes a new SW took over — reload to pick up fresh chunk hashes
// (without this, lazy-loaded tabs request old hashed filenames that no longer exist).
let currentController = navigator.serviceWorker?.controller
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (currentController) {
    window.location.reload()
  }
  currentController = navigator.serviceWorker?.controller ?? null
})

// ── Onboarding ──────────────────────────────────────────────────
const onboardingComplete = ref(!!localStorage.getItem('onboarding-complete'))
const workoutStoreForOnboarding = useWorkoutStore()
const bodyweightStoreForOnboarding = useBodyweightStore()

// Skip onboarding if user already has any data (exercises or bodyweight entries)
// Reactive so it catches data that loads asynchronously after auth.
// onboardingInProgress prevents the watcher from firing when the onboarding
// screen itself adds exercises (e.g. Popular Exercises option).
const onboardingInProgress = ref(false)
watch(
  () => workoutStoreForOnboarding.exercises.length + bodyweightStoreForOnboarding.entries.length,
  (total) => {
    if (!onboardingComplete.value && !onboardingInProgress.value && total > 0) {
      localStorage.setItem('onboarding-complete', 'true')
      onboardingComplete.value = true
    }
  },
  { immediate: true },
)
const showOnboarding = computed(() => !onboardingComplete.value)
const hasSampleData = ref(localStorage.getItem('sample-data') === 'true')

function onOnboardingComplete() {
  onboardingInProgress.value = false
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
  localStorage.setItem('fresh-start', 'true')
  hasSampleData.value = false
  window.dispatchEvent(new CustomEvent('fresh-start'))
}

function closeSettings() {
  if (!settingsOpen.value) return
  const sheet = settingsSheetRef.value
  if (sheet) {
    sheet.close()
  } else {
    settingsOpen.value = false
  }
}

function handleSettingsSignOut() {
  onboardingComplete.value = false
  signOut()
}
// ── Tab initialization (supports PWA manifest shortcuts via ?tab= param) ──
const VALID_TABS = ['workouts', 'calendar', 'weight'] as const
const urlTab = new URLSearchParams(window.location.search).get('tab')
const initialTab = urlTab && VALID_TABS.includes(urlTab as typeof VALID_TABS[number])
  ? urlTab
  : localStorage.getItem('active-tab') || 'workouts'
const activeTab = ref(initialTab)
// Clean up the query param so it doesn't persist on reload
if (urlTab) {
  const url = new URL(window.location.href)
  url.searchParams.delete('tab')
  window.history.replaceState({}, '', url.pathname)
}

// ── Keyboard shortcuts ─────────────────────────────────────────────
const { helpOpen: shortcutsOpen, toggleHelp: toggleShortcuts, closeHelp: closeShortcuts } = useKeyboardShortcuts(() => [
  { key: '?', label: 'Show keyboard shortcuts', action: toggleShortcuts },
  { key: '1', label: 'Go to Workouts', action: () => switchTab('workouts') },
  { key: '2', label: 'Go to Calendar', action: () => switchTab('calendar') },
  { key: '3', label: 'Go to Weight', action: () => switchTab('weight') },
  { key: ',', label: 'Open settings', action: () => { settingsOpen.value = true } },
  { key: 'Escape', label: 'Close panel', action: () => { closeSettings(); closeShortcuts() }, global: true },
])

// ── Focus trap watch for keyboard shortcuts modal ────────────
watch(shortcutsOpen, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.kbSheet')
    if (el) shortcutsFocus.activate(el)
  } else {
    shortcutsFocus.deactivate()
  }
})

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
    switchTab(visibleTabs.value[0]?.id || 'workouts')
  }
}, { deep: true })

// ── Tab scroll position preservation ─────────────────────────────
const tabContentEl = ref<HTMLElement | null>(null)
const tabScrollPositions: Record<string, number> = {}

// ── Analytics ────────────────────────────────────────────────────
function switchTab(tabId: string) {
  const from = activeTab.value
  closeSettings()
  if (from === tabId) return
  // Save scroll position of outgoing tab
  if (tabContentEl.value) {
    tabScrollPositions[from] = tabContentEl.value.scrollTop
  }
  activeTab.value = tabId
  localStorage.setItem('active-tab', tabId)
  tabSwitch(from, tabId)
  checkForSWUpdate()
  // Restore scroll position of incoming tab (default to top)
  nextTick(() => {
    if (tabContentEl.value) {
      tabContentEl.value.scrollTop = tabScrollPositions[tabId] ?? 0
    }
  })
}

// Exposed from WorkoutTracker via defineExpose so the top-bar "+" can trigger
// the same quick-log exercise-picker flow the in-content "+ Log Set" uses.
const workoutTrackerRef = ref<InstanceType<typeof WorkoutTracker> | null>(null)

function triggerQuickLog() {
  const wt = workoutTrackerRef.value
  if (wt && typeof wt.openTimelineLogModal === 'function') {
    wt.openTimelineLogModal()
  }
}

// Flush engagement timing on page unload
function onBeforeUnload() {
  flushEngagement()
}

// ── Startup: progression migration + theme enforcement ────────
/** If current theme is locked, switch to pearl. */
function enforceThemeLock() {
  if (!isThemeUnlocked(currentTheme.value as ThemeId)) {
    currentTheme.value = 'pearl'
  }
}

function runMigrationIfNeeded() {
  if (progressionStore.progressionEnabled && !isMigrated()) {
    const result = computeRetroactiveXP(workoutStoreForOnboarding.exercises, bodyweightStoreForOnboarding.entries)
    if (result.totalXP > 0) {
      progressionStore.totalXP = result.totalXP
      progressionStore.xpPerSet = result.xpPerSet
      progressionStore.bodyweightXPDates = result.bodyweightXPDates
      const newUnlocks = progressionStore.checkUnlocks()
      progressionStore._persist()
      if (newUnlocks.length > 0) {
        celebrateUnlocks(newUnlocks)
      }
    }
    markMigrated()
  }
}

function buildSetIdToDate(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const exercise of workoutStoreForOnboarding.exercises) {
    for (const set of exercise.sets) {
      map[set.id] = set.date.slice(0, 10)
    }
  }
  return map
}

function applyStreakTargetCorrection() {
  const MIGRATION_KEY = 'streak-target-correction-v1'
  if (localStorage.getItem(MIGRATION_KEY)) return
  localStorage.setItem(MIGRATION_KEY, new Date().toISOString())
  if (!progressionStore.progressionEnabled) return
  if (progressionStore.pendingTargetChange === null) return
  progressionStore.weeklyTarget = progressionStore.pendingTargetChange
  progressionStore.pendingTargetChange = null
  progressionStore.reEvaluateStreaks(workoutStoreForOnboarding.workoutDates, new Date(), buildSetIdToDate())
}

function catchUpStreaks() {
  applyStreakTargetCorrection()
  const streakBefore = progressionStore.streakWeeks
  progressionStore.evaluatePendingWeeks(workoutStoreForOnboarding.workoutDates, new Date(), buildSetIdToDate())
  const streakAfter = progressionStore.streakWeeks

  if (progressionStore.showProgression && streakAfter > streakBefore) {
    const MILESTONES = [12, 8, 4, 2] as const
    for (const m of MILESTONES) {
      if (streakAfter >= m && streakBefore < m) {
        const mult = streakAfter >= 12 ? '1.75' : streakAfter >= 8 ? '1.5' : streakAfter >= 4 ? '1.25' : '1.1'
        setTimeout(() => showXPToast(
          `${streakAfter}-week streak! Duration bonus: ${mult}×`,
          progressionStore.progressPercent,
          progressionStore.totalXP,
          progressionStore.nextUnlockThreshold
        ), 1500)
        break
      }
    }
  }
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  logEvent('session_start')

  initSupabase()
    .then(() => initAuth())
    .catch(() => initAuth())

  requestPersistentStorage()

  const restored = await Promise.all([
    ensureLocalStorage('workout-exercises'),
    ensureLocalStorage('bodyweight-entries'),
    ensureLocalStorage('user-progression'),
    ensureLocalStorage('user-preferences'),
  ])
  if (restored.some(r => r)) {
    location.reload()
    return
  }

  runMigrationIfNeeded()
  enforceThemeLock()

  if (progressionStore.progressionEnabled) {
    catchUpStreaks()
  }

  // Cross-tab sync: reload stores when another tab persists data
  const storeMap: Record<StoreKey, { _reloadFromStorage(): void }> = {
    workout: useWorkoutStore(),
    bodyweight: useBodyweightStore(),
    preferences: usePreferencesStore(),
    progression: progressionStore,
  }
  unsubCrossTab = onCrossTabMessage((msg) => {
    if (msg.type === 'store-update') {
      storeMap[msg.store]?._reloadFromStorage()
    } else if (msg.type === 'sync-status') {
      syncStatus.value = msg.status
    }
  })
})
let unsubCrossTab: (() => void) | null = null
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  unsubCrossTab?.()
})
</script>
