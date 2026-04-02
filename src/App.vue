<template>
  <ErrorBoundary>
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
        <div class="appTopBar">
          <button
            class="settingsGearBtn"
            @click="settingsOpen ? closeSettings() : (settingsOpen = true)"
            title="Settings"
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
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
            <!-- eslint-disable-next-line vue/no-v-html, vue/html-self-closing -- icons are hardcoded SVG paths, not user input -->
            <svg class="tabIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="tab.icon"></svg>
            <span class="tabLabel">{{ tab.label }}</span>
          </button>
        </div>
      </nav>

      <!-- Settings bottom sheet -->
      <Teleport to="body">
        <div v-if="settingsOpen" class="settingsOverlay" @click.self="closeSettings" @keydown.escape="closeSettings">
          <div class="settingsSheet" :ref="onSettingsSheetMounted" :style="settingsSwipe.dragStyle()" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div class="sheetDragHandle" aria-hidden="true"><span class="sheetDragPill"></span></div>

            <div class="settingsGroup">
              <div class="settingsHeader" id="settings-title">Appearance</div>
              <div class="settingsThemeGrid">
                <button
                  v-for="t in THEMES"
                  :key="t.id"
                  :class="['themePreview', { active: currentTheme === t.id }]"
                  @click="selectTheme(t.id)"
                  :aria-label="'Select ' + t.label + ' theme'"
                  :aria-pressed="currentTheme === t.id"
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
                    v-for="m in (['light', 'auto', 'dark'] as const)"
                    :key="m"
                    :class="['modeSegBtn', { active: colorMode === m }]"
                    @click="setMode(m)"
                    :aria-label="m[0].toUpperCase() + m.slice(1) + ' mode'"
                    :aria-pressed="colorMode === m"
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
                  <button :class="['modeSegBtn', { active: weightUnit === 'lbs' }]" @click="weightUnit = 'lbs'" aria-label="Use pounds" :aria-pressed="weightUnit === 'lbs'">lbs</button>
                  <button :class="['modeSegBtn', { active: weightUnit === 'kg' }]" @click="weightUnit = 'kg'" aria-label="Use kilograms" :aria-pressed="weightUnit === 'kg'">kg</button>
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
              <div v-if="restTimerEnabled" class="settingsRow">
                <span class="settingsLabel settingsLabelIndented">Auto-start after logging</span>
                <button
                  :class="['glassToggle', { on: restTimerAutoStart }]"
                  @click="restTimerAutoStart = !restTimerAutoStart"
                  role="switch"
                  :aria-checked="restTimerAutoStart"
                  :aria-label="restTimerAutoStart ? 'Disable auto-start' : 'Enable auto-start'"
                >
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
            </div>

            <div class="settingsGroup">
              <div class="settingsHeader">Data</div>
              <div class="settingsRow">
                <span class="settingsLabel">Export</span>
                <div class="exportBtnGroup">
                  <button class="exportBtn" @click="exportData('csv')" aria-label="Export data as CSV">CSV</button>
                  <button class="exportBtn" @click="exportData('json')" aria-label="Export data as JSON">JSON</button>
                </div>
              </div>
              <div class="privacyTransparency" role="region" aria-label="Data transparency">
                <div class="privacyRow">
                  <svg class="privacyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12h.01"/></svg>
                  <span class="privacyText">Your data lives on your device first</span>
                </div>
                <div class="privacyRow">
                  <svg class="privacyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  <span class="privacyText">{{ user ? 'Synced over encrypted HTTPS' : 'Sign in to sync across devices' }}</span>
                </div>
                <div class="privacyRow">
                  <svg class="privacyIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  <span class="privacyText">No tracking, no ads, no data sales</span>
                </div>
              </div>
            </div>

            <div class="settingsGroup">
              <div class="settingsHeader">Legal</div>
              <button class="settingsRow settingsRowBtn" @click="legalView = 'privacy'">
                <span class="settingsLabel">Privacy Policy</span>
                <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button class="settingsRow settingsRowBtn" @click="legalView = 'terms'">
                <span class="settingsLabel">Terms of Service</span>
                <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            <div class="settingsGroup">
              <button class="settingsSignOut" @click="confirmSignOut">Sign Out</button>
            </div>
          </div>
        </div>
      </Teleport>
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

    <!-- SW update toast -->
    <Teleport to="body">
      <Transition name="undoToast">
        <div v-if="swNeedRefresh" class="undoToastBar swUpdateBar" role="status" aria-live="polite">
          <span class="undoToastMsg">New version available</span>
          <button class="undoToastBtn" @click="updateSW()">Update</button>
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

    <!-- Legal modal (Privacy Policy / Terms of Service) -->
    <Teleport to="body">
      <Transition name="undoToast">
        <div v-if="legalView" class="kbOverlay" @click.self="legalView = null" @keydown.escape="legalView = null">
          <div class="legalSheet" role="dialog" aria-modal="true" :aria-labelledby="'legal-title'">
            <div class="legalHeader">
              <h3 id="legal-title" class="kbTitle">{{ legalView === 'privacy' ? 'Privacy Policy' : 'Terms of Service' }}</h3>
              <button class="kbClose legalClose" @click="legalView = null">Close</button>
            </div>
            <div class="legalBody">
              <!-- Privacy Policy -->
              <template v-if="legalView === 'privacy'">
                <p class="legalUpdated">Last updated: March 31, 2026</p>
                <h4 class="legalH4">What We Collect</h4>
                <p>Lift collects only the data you explicitly enter: exercises, sets, reps, weights, and bodyweight entries. If you create an account, we store your email address for authentication.</p>
                <h4 class="legalH4">How Data Is Stored</h4>
                <p>Your workout data is stored locally on your device using browser storage (localStorage). If you sign in, data is synced to Supabase (our cloud database) so you can access it across devices. Data is transmitted over HTTPS.</p>
                <h4 class="legalH4">Analytics</h4>
                <p>We use Vercel Analytics to collect anonymous, aggregated usage data (page views, feature usage). No personally identifiable information is included in analytics events.</p>
                <h4 class="legalH4">Third-Party Services</h4>
                <ul class="legalList">
                  <li><strong>Supabase</strong> — authentication and cloud data sync</li>
                  <li><strong>Vercel</strong> — hosting and anonymous analytics</li>
                </ul>
                <h4 class="legalH4">Data Deletion</h4>
                <p>You can export or delete your data at any time. Use the Export feature in Settings to download your data as CSV or JSON. To delete your account and all associated data, contact us at the email below.</p>
                <h4 class="legalH4">Contact</h4>
                <p>For privacy questions, email <strong>aaronschung@gmail.com</strong>.</p>
              </template>
              <!-- Terms of Service -->
              <template v-else>
                <p class="legalUpdated">Last updated: March 31, 2026</p>
                <h4 class="legalH4">Acceptance</h4>
                <p>By using Lift, you agree to these terms. If you do not agree, please do not use the app.</p>
                <h4 class="legalH4">Description</h4>
                <p>Lift is a free workout tracking application provided as-is. We make no guarantees about uptime, data retention, or feature availability.</p>
                <h4 class="legalH4">User Responsibilities</h4>
                <p>You are responsible for maintaining the security of your account credentials. Do not share your login with others. You retain ownership of all data you enter into Lift.</p>
                <h4 class="legalH4">Acceptable Use</h4>
                <p>Do not attempt to exploit, reverse-engineer, or interfere with the operation of the app or its infrastructure.</p>
                <h4 class="legalH4">Limitation of Liability</h4>
                <p>Lift is provided "as is" without warranty of any kind. We are not liable for any data loss, injury, or damages arising from use of this app. Always consult a medical professional before starting any exercise program.</p>
                <h4 class="legalH4">Changes</h4>
                <p>We may update these terms at any time. Continued use of Lift after changes constitutes acceptance of the updated terms.</p>
                <h4 class="legalH4">Contact</h4>
                <p>For questions about these terms, email <strong>aaronschung@gmail.com</strong>.</p>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    <!-- Custom confirmation dialog (Capacitor-safe, no window.confirm) -->
    <Teleport to="body">
      <Transition name="undoToast">
        <div v-if="confirmDialog" class="confirmOverlay" @click.self="dismissConfirm" @keydown.escape="dismissConfirm">
          <div class="confirmSheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
            <p id="confirm-msg" class="confirmMessage">{{ confirmDialog.message }}</p>
            <div class="confirmActions">
              <button class="confirmBtn confirmBtnCancel" @click="dismissConfirm">Cancel</button>
              <button class="confirmBtn confirmBtnConfirm" @click="acceptConfirm">Confirm</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
  </ErrorBoundary>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent, type ComponentPublicInstance } from 'vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import AuthScreen from './components/AuthScreen.vue'
import OnboardingScreen from './components/OnboardingScreen.vue'

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
import { useTheme } from './composables/useTheme'
import { useAuth } from './composables/useAuth'
import { useAnalytics } from './composables/useAnalytics'
import { usePreferencesStore } from './stores/preferences'
import { useWorkoutStore } from './stores/workout'
import { useBodyweightStore } from './stores/bodyweight'
import { useUndoToast } from './composables/useUndoToast'
import { useSwipeToDismiss } from './composables/useSwipeToDismiss'
import { useFocusTrap } from './composables/useFocusTrap'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { registerSW } from 'virtual:pwa-register'

const { currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode, glassEnabled, restTimerEnabled, restTimerAutoStart, weightUnit } = useTheme()
const { user, loading, signOut } = useAuth()
const { logEvent, tabSwitch, flushEngagement } = useAnalytics()
const prefs = usePreferencesStore()
const { toast: undoToast, performUndo } = useUndoToast()

const settingsOpen = ref(false)
const settingsEl = ref<HTMLElement | null>(null)
const legalView = ref<'privacy' | 'terms' | null>(null)


// ── Swipe-to-dismiss for settings sheet ────────────────────────
const settingsSwipe = useSwipeToDismiss({
  threshold: 80,
  onDismiss: () => { settingsOpen.value = false },
})

// ── Focus traps for modals ─────────────────────────────────────
const settingsFocus = useFocusTrap()
const shortcutsFocus = useFocusTrap()
const legalFocus = useFocusTrap()
const confirmFocus = useFocusTrap()

watch(settingsOpen, (open) => {
  if (!open) {
    settingsSwipe.detach()
    settingsFocus.deactivate()
  }
})

function onSettingsSheetMounted(el: Element | ComponentPublicInstance | null) {
  if (el && el instanceof HTMLElement) {
    settingsEl.value = el
    settingsSwipe.attach(el)
    settingsFocus.activate(el)
  }
}

// ── Service worker update prompt ────────────────────────────────
const swNeedRefresh = ref(false)
const updateSW = registerSW({
  onNeedRefresh() { swNeedRefresh.value = true },
})

// ── Onboarding ──────────────────────────────────────────────────
const onboardingComplete = ref(!!localStorage.getItem('onboarding-complete'))
const workoutStoreForOnboarding = useWorkoutStore()
const bodyweightStoreForOnboarding = useBodyweightStore()

// Skip onboarding if user already has any data (exercises or bodyweight entries)
// Reactive so it catches data that loads asynchronously after auth
watch(
  () => workoutStoreForOnboarding.exercises.length + bodyweightStoreForOnboarding.entries.length,
  (total) => {
    if (!onboardingComplete.value && total > 0) {
      localStorage.setItem('onboarding-complete', 'true')
      onboardingComplete.value = true
    }
  },
  { immediate: true },
)
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

// ── Keyboard shortcuts ─────────────────────────────────────────────
const { helpOpen: shortcutsOpen, toggleHelp: toggleShortcuts, closeHelp: closeShortcuts } = useKeyboardShortcuts(() => [
  { key: '?', label: 'Show keyboard shortcuts', action: toggleShortcuts },
  { key: '1', label: 'Go to Workouts', action: () => switchTab('workouts') },
  { key: '2', label: 'Go to Calendar', action: () => switchTab('calendar') },
  { key: '3', label: 'Go to Weight', action: () => switchTab('weight') },
  { key: ',', label: 'Open settings', action: () => { settingsOpen.value = true } },
  { key: 'Escape', label: 'Close panel', action: () => { closeSettings(); closeShortcuts() }, global: true },
])

// ── Confirm dialog state (declared before watchers that reference it) ──
const confirmDialog = ref<{ message: string; onConfirm: () => void } | null>(null)

// ── Focus trap watches for v-if modals ─────────────────────────
watch(shortcutsOpen, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.kbSheet')
    if (el) shortcutsFocus.activate(el)
  } else {
    shortcutsFocus.deactivate()
  }
})

watch(legalView, async (view) => {
  if (view) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.legalSheet')
    if (el) legalFocus.activate(el)
  } else {
    legalFocus.deactivate()
  }
})

watch(confirmDialog, async (dialog) => {
  if (dialog) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.confirmSheet')
    if (el) confirmFocus.activate(el)
  } else {
    confirmFocus.deactivate()
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
    activeTab.value = visibleTabs.value[0]?.id || 'workouts'
  }
}, { deep: true })

// ── Analytics ────────────────────────────────────────────────────
function switchTab(tabId: string) {
  const from = activeTab.value
  closeSettings()
  if (from === tabId) return
  activeTab.value = tabId
  localStorage.setItem('active-tab', tabId)
  tabSwitch(from, tabId)
}

function selectTheme(id: string) {
  currentTheme.value = id
  logEvent('theme_change', { theme: id })
}

function setMode(mode: 'light' | 'dark' | 'auto') {
  colorMode.value = mode
  logEvent('mode_toggle', { mode })
}

function toggleGlass() {
  glassEnabled.value = !glassEnabled.value
  logEvent('glass_toggle', { enabled: glassEnabled.value })
}

function showConfirm(message: string, onConfirm: () => void) {
  confirmDialog.value = { message, onConfirm }
}

function dismissConfirm() {
  confirmDialog.value = null
}

function acceptConfirm() {
  confirmDialog.value?.onConfirm()
  confirmDialog.value = null
}

function confirmSignOut() {
  showConfirm('Sign out?', () => {
    settingsOpen.value = false
    localStorage.removeItem('onboarding-complete')
    onboardingComplete.value = false
    signOut()
  })
}

function exportData(format: 'csv' | 'json') {
  const workoutStore = useWorkoutStore()
  const bwStore = useBodyweightStore()
  const timestamp = new Date().toISOString().slice(0, 10)

  if (format === 'json') {
    const data = {
      exportDate: new Date().toISOString(),
      exercises: workoutStore.exercises.map(e => ({
        name: e.name,
        tags: e.tags,
        sets: e.sets.map(s => ({
          date: s.date,
          weight: s.weight,
          reps: s.reps,
          estimated1RM: s.estimated1RM,
        })),
      })),
      bodyweight: bwStore.sortedEntries.map(e => ({
        date: e.date,
        weight: e.weight,
      })),
    }
    downloadFile(`lift-export-${timestamp}.json`, JSON.stringify(data, null, 2), 'application/json')
  } else {
    const lines = ['Exercise,Date,Weight,Reps,Estimated 1RM,Tags']
    for (const ex of workoutStore.exercises) {
      for (const s of ex.sets) {
        const date = s.date.slice(0, 10)
        const tags = ex.tags.join(';')
        lines.push(`${csvEscape(ex.name)},${date},${s.weight},${s.reps},${s.estimated1RM},${csvEscape(tags)}`)
      }
    }
    if (bwStore.sortedEntries.length > 0) {
      lines.push('')
      lines.push('Date,Body Weight')
      for (const e of bwStore.sortedEntries) {
        lines.push(`${e.date.slice(0, 10)},${e.weight}`)
      }
    }
    downloadFile(`lift-export-${timestamp}.csv`, lines.join('\n'), 'text/csv')
  }
  logEvent('data_export', { format })
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function toggleFeature(featureId: string) {
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
