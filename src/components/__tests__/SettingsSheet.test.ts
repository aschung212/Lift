import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, reactive, computed, defineComponent, nextTick } from 'vue'
import { mount, VueWrapper, enableAutoUnmount } from '@vue/test-utils'
import { useModal } from '../../composables/useModal'
import { resolveStrengthBaseline } from '../../lib/strengthBaseline'
import { mockIntersectionObservers } from '../../__tests__/setup'

// The Support-group visibility observer (LIFT-906) is the most-recently armed
// IntersectionObserver; grab it to fire an intersection deliberately.
function lastIntersectionObserver() {
  const observer = mockIntersectionObservers.at(-1)
  if (!observer) throw new Error('no IntersectionObserver was armed')
  return observer
}

// Unmount every wrapper after each test. The sheet now holds a background-
// scroll lock while open, and useModal's reference count is module state
// shared across this file — a wrapper left mounted keeps `html.modal-open`
// applied forever and makes the lock assertions below vacuous.
enableAutoUnmount(afterEach)

// SettingsSheet is one of the two "god components" in the repo (the other,
// WorkoutTracker, is already covered). It owns theme switching, the weight-unit
// toggle, every experience/feature toggle, weekly-goal config, PR baseline,
// intensity presets, data export/report/import, gym management, and the
// support/legal/danger-zone rows — all high-churn state that regresses
// silently. This suite mounts it with the stores/composables mocked (mirroring
// WorkoutTracker.test.ts) and asserts toggle→store wiring plus modal open/close.

// ── Analytics (stable spy so we can assert logged events) ──────────
const mockLogEvent = vi.fn()
const mockSupportFunnel = vi.fn()
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: mockLogEvent,
    // The supporter-funnel impression (LIFT-906) fires when the Support group
    // actually scrolls into view (via IntersectionObserver), not on open — so
    // tap/impression stays a meaningful conversion rate rather than counting
    // every Settings open, where the Support group (12th of 14) is unseen.
    supportFunnel: mockSupportFunnel,
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  }),
}))

// ── Theme (drives the Appearance section) ──────────────────────────
const mockCurrentTheme = ref('eternal')
const mockColorMode = ref<'light' | 'dark' | 'auto'>('dark')
const mockSelectTheme = vi.fn(() => true)
const mockPreviewTheme = vi.fn()
const mockRevertPreview = vi.fn()
const THEMES = [
  { id: 'eternal', label: 'Eternal', icon: 'eternal' },
  { id: 'pearl', label: 'Origin', icon: 'pearl' },
  { id: 'midnight', label: 'Fortitude', icon: 'midnight' },
  { id: 'fire', label: 'Intensity', icon: 'fire' },
  { id: 'water', label: 'Flow', icon: 'water' },
  { id: 'earth', label: 'Stability', icon: 'earth' },
  { id: 'luck', label: 'Luck', icon: 'luck' },
  { id: 'amethyst', label: 'Focus', icon: 'amethyst' },
  { id: 'air', label: 'Energy', icon: 'air' },
  { id: 'love', label: 'Love', icon: 'love' },
]
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({
    currentTheme: mockCurrentTheme,
    THEMES,
    THEME_PREVIEWS: {},
    colorMode: mockColorMode,
    resolvedMode: ref('dark'),
    selectTheme: mockSelectTheme,
    previewTheme: mockPreviewTheme,
    revertPreview: mockRevertPreview,
    isThemeUnlocked: () => true,
  }),
}))

// ── Weight unit (the Units segmented control) ──────────────────────
const mockWeightUnit = ref<'lbs' | 'kg'>('lbs')
vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: mockWeightUnit,
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  }),
}))

// ── Rest timer (Experience toggles) ────────────────────────────────
const mockRestTimerEnabled = ref(false)
const mockRestTimerAutoStart = ref(false)
vi.mock('../../composables/useRestTimer', () => ({
  useRestTimer: () => ({
    restTimerEnabled: mockRestTimerEnabled,
    restTimerAutoStart: mockRestTimerAutoStart,
  }),
}))

// ── PR baseline + strength baseline mode (#1272) ───────────────────
// The mock has to stay faithful to the real composable's split: `prBaselineDate`
// is the mode-RESOLVED baseline and `prBaselineAnchor` is the raw stored date
// the Settings input binds to. Writing the setters through to the refs (rather
// than leaving bare spies) is what lets the mode-dependent rows below actually
// render — a spy-only mock would leave the sheet permanently in lifetime mode
// and the recent-window assertions would pass vacuously.
const mockPrBaselineAnchor = ref<string | null>(null)
const mockStrengthBaselineMode = ref<'lifetime' | 'recent'>('lifetime')
const mockRecentBaselineWeeks = ref(8)
// A fixed "today" rather than the real clock: the sheet's hint copy branches on
// whether the anchor or the window won, so the mock has to resolve them the way
// production does. Hardcoding a resolved date instead would make the
// anchor-wins branch unreachable and its assertion vacuous.
const MOCK_TODAY = '2026-08-30'
const mockPrBaselineDate = computed(() => resolveStrengthBaseline({
  mode: mockStrengthBaselineMode.value,
  anchor: mockPrBaselineAnchor.value,
  weeks: mockRecentBaselineWeeks.value,
  todayKey: MOCK_TODAY,
}))
const mockSetPRBaseline = vi.fn((date: string | null) => { mockPrBaselineAnchor.value = date })
const mockStartNewTrainingBlock = vi.fn()
const mockClearPRBaseline = vi.fn(() => { mockPrBaselineAnchor.value = null })
const mockSetStrengthBaselineMode = vi.fn((mode: 'lifetime' | 'recent') => { mockStrengthBaselineMode.value = mode })
const mockSetRecentBaselineWeeks = vi.fn((weeks: number) => { mockRecentBaselineWeeks.value = weeks })
vi.mock('../../composables/usePRBaseline', () => ({
  usePRBaseline: () => ({
    prBaselineDate: mockPrBaselineDate,
    prBaselineAnchor: mockPrBaselineAnchor,
    strengthBaselineMode: mockStrengthBaselineMode,
    recentBaselineWeeks: mockRecentBaselineWeeks,
    setPRBaseline: mockSetPRBaseline,
    startNewTrainingBlock: mockStartNewTrainingBlock,
    clearPRBaseline: mockClearPRBaseline,
    setStrengthBaselineMode: mockSetStrengthBaselineMode,
    setRecentBaselineWeeks: mockSetRecentBaselineWeeks,
  }),
}))

// ── Progression store (kept disabled so the streak/starter machinery
//    stays out of the way — the exposed surface still has to be present). ─
const mockProgression = reactive({
  progressionEnabled: false,
  showProgression: false,
  streakWeeks: 0,
  currentMultiplier: 1,
  totalXP: 0,
  nextUnlockThreshold: 5000,
  progressPercent: 0,
  xpToNextUnlock: 5000,
  weeklyTarget: 3,
  pendingTargetChange: null as number | null,
  starterConfirmed: true,
  starterTheme: 'fire',
  unlockedThemes: [{ id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' }],
  xpPerSet: {},
  epoch: 1,
  streakHistory: [] as unknown[],
  bodyweightXPDates: [] as string[],
})
const mockSetShowProgression = vi.fn()
const mockSetWeeklyTarget = vi.fn()
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => Object.assign(mockProgression, {
    setShowProgression: mockSetShowProgression,
    setWeeklyTarget: mockSetWeeklyTarget,
    setStarterTheme: vi.fn(),
    checkUnlocks: vi.fn().mockReturnValue([]),
    evaluatePendingWeeks: vi.fn(),
    _persist: vi.fn(),
    _syncToSupabase: vi.fn(),
  }),
  // Inlined (not a top-level const) so the hoisted factory can reference it.
  UNLOCK_TIERS: [
    { level: 0, xpRequired: 0, themeId: 'pearl' },
    { level: 1, xpRequired: 5000, themeId: null },
    { level: 2, xpRequired: 15000, themeId: 'air' },
    { level: 8, xpRequired: 1000000, themeId: 'eternal' },
  ],
}))

// ── Preferences store (owns most of the toggles under test) ────────
const mockSetExperienceFlag = vi.fn((key: string, val: boolean) => {
  ;(mockPrefs.experience as Record<string, boolean>)[key] = val
})
const mockToggleFeature = vi.fn((id: string) => {
  ;(mockPrefs.features as Record<string, boolean>)[id] = !(mockPrefs.features as Record<string, boolean>)[id]
})
const mockSetWarmupThreshold = vi.fn()
const mockSetIntensityPresets = vi.fn((v: number[]) => { mockPrefs.intensityPresets = v })
const mockSetWeightGoalDirection = vi.fn((dir: string) => { mockPrefs.weightGoal.direction = dir })
const mockPrefs = reactive({
  experience: { haptics: true, prCelebrations: true, screenWakeLock: true, restTimerNotification: true },
  features: { workouts: true, calendar: true, weight: true } as Record<string, boolean>,
  enabledCount: 3,
  filters: { warmupThreshold: 0.75 },
  intensityPresets: [50, 70, 80, 90, 100] as number[],
  gyms: [] as string[],
  weightGoal: { direction: 'maintain', maintainMin: null, maintainMax: null, loseTarget: null, gainTarget: null } as Record<string, unknown>,
  hasAnyGoalValue: false,
  currentTarget: null as number | null,
  prBaselineDate: null as string | null,
  appIcon: 'default',
  setExperienceFlag: mockSetExperienceFlag,
  toggleFeature: mockToggleFeature,
  setWarmupThreshold: mockSetWarmupThreshold,
  setIntensityPresets: mockSetIntensityPresets,
  setWeightGoalDirection: mockSetWeightGoalDirection,
  setTargetForDirection: vi.fn(),
  setMaintainRange: vi.fn(),
  clearAllGoalValues: vi.fn(),
  setAppIcon: vi.fn(),
})
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => mockPrefs,
}))

// ── Workout / bodyweight stores (read-only from this component) ─────
const mockToggleExerciseTag = vi.fn()
const mockWorkoutStore = reactive({
  exercises: [] as unknown[],
  allTags: [] as string[],
  workoutDates: [],
  addExercise: vi.fn(),
  logSet: vi.fn(),
  toggleExerciseTag: mockToggleExerciseTag,
  renameGymOnExercises: vi.fn(),
  removeGymFromExercises: vi.fn(() => []),
})
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => mockWorkoutStore,
}))
vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    entries: [],
    sortedEntries: [],
    latestWeight: null,
  }),
}))

// ── Auth (Sign Out / Delete Account) ───────────────────────────────
// `user` is TRUTHY for a guest — continueAsGuest stores the `guest-local`
// sentinel (LIFT-1083) — so the two refs are driven independently here. A guest
// fixture that left `user` null would make the sync-claim assertion below
// vacuous: it would pass off the falsy `user` rather than off `isGuest`.
const mockDeleteAccount = vi.fn().mockResolvedValue(undefined)
const mockUser = ref<{ id: string; email: string } | null>(null)
const mockIsGuest = ref(false)
vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isGuest: mockIsGuest, deleteAccount: mockDeleteAccount }),
}))

// ── XP ceremony, app share, gym actions — no-op surfaces ───────────
vi.mock('../../composables/useXPCeremony', () => ({
  useXPCeremony: () => ({ celebrateUnlocks: vi.fn() }),
}))
const mockShareApp = vi.fn().mockResolvedValue({ kind: 'shared' })
vi.mock('../../composables/useAppShare', () => ({
  useAppShare: () => ({ shareApp: mockShareApp, isSharing: ref(false), lastError: ref(null) }),
}))
const mockToggleExerciseGym = vi.fn()
vi.mock('../../composables/useGymActions', () => ({
  useGymActions: () => ({
    createGym: vi.fn(),
    renameGym: vi.fn(),
    deleteGym: vi.fn(),
    toggleExerciseGym: mockToggleExerciseGym,
  }),
}))

// ── Swipe / focus (DOM side-effect composables) ────────────────────
vi.mock('../../composables/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({ attach: vi.fn(), detach: vi.fn(), dragStyle: () => ({}) }),
}))
vi.mock('../../composables/useFocusTrap', () => ({
  useFocusTrap: () => ({ activate: vi.fn(), deactivate: vi.fn() }),
}))

// ── Native/icon/IDB side-effect libs (import-guarded) ──────────────
vi.mock('../../lib/nativeAppIcon', () => ({ setNativeAppIcon: vi.fn() }))
vi.mock('../../lib/durableStorage', () => ({ clearIDB: vi.fn() }))
vi.mock('../../composables/xpCeremonyUI', () => ({ showXPToast: vi.fn() }))

import SettingsSheet from '../SettingsSheet.vue'

// Child modal stubs that surface the props under test into the DOM, so open/
// close can be asserted without reaching into `<script setup>` internals (only
// closeSettings is defineExpose'd). Transition is left real — VTU renders its
// slot synchronously, so the confirm/delete dialogs appear on state change.
const LegalSheetStub = { props: ['view'], template: '<div class="legal-stub" :data-view="view ?? \'\'" />' }
const GymManagerModalStub = { props: ['open'], template: '<div class="gym-stub" :data-open="String(open)" />' }
const ExerciseManagerModalStub = { props: ['open', 'exercises', 'gyms', 'allTags'], template: '<div class="exercise-stub" :data-open="String(open)" :data-gyms="gyms.join(\',\')" :data-tags="allTags.join(\',\')" />' }

function mountSheet(open = true): VueWrapper {
  return mount(SettingsSheet, {
    props: { modelValue: open },
    global: {
      stubs: {
        Teleport: true,
        LegalSheet: LegalSheetStub,
        ThemeStatsSheet: true,
        GymManagerModal: GymManagerModalStub,
        ExerciseManagerModal: ExerciseManagerModalStub,
        StarterPickerFlow: true,
      },
    },
  })
}

describe('SettingsSheet', () => {
  beforeEach(() => {
    mockCurrentTheme.value = 'eternal'
    mockColorMode.value = 'dark'
    mockWeightUnit.value = 'lbs'
    mockRestTimerEnabled.value = false
    mockRestTimerAutoStart.value = false
    mockPrefs.experience = { haptics: true, prCelebrations: true, screenWakeLock: true, restTimerNotification: true }
    mockPrefs.features = { workouts: true, calendar: true, weight: true }
    mockPrefs.enabledCount = 3
    mockPrefs.intensityPresets = [50, 70, 80, 90, 100]
    mockPrefs.gyms = []
    mockWorkoutStore.exercises = []
    mockWorkoutStore.allTags = []
    mockPrefs.weightGoal = { direction: 'maintain', maintainMin: null, maintainMax: null, loseTarget: null, gainTarget: null }
    mockProgression.progressionEnabled = false
    mockPrBaselineAnchor.value = null
    mockStrengthBaselineMode.value = 'lifetime'
    mockRecentBaselineWeeks.value = 8
    mockUser.value = null
    mockIsGuest.value = false
    vi.clearAllMocks()
  })

  /** Local-only guest (LIFT-1083): a truthy sentinel user AND the guest flag. */
  function continueAsGuest() {
    mockUser.value = { id: 'guest-local', email: '' }
    mockIsGuest.value = true
  }

  /** A real Supabase session — the non-guest side of every fork below. */
  function signIn() {
    mockUser.value = { id: 'a3f1c2d4-0000-4000-8000-000000000001', email: 'a@b.co' }
    mockIsGuest.value = false
  }

  describe('visibility', () => {
    it('renders nothing when modelValue is false', () => {
      const wrapper = mountSheet(false)
      expect(wrapper.find('.settingsOverlay').exists()).toBe(false)
    })

    it('renders the settings dialog when modelValue is true', () => {
      const wrapper = mountSheet()
      const dialog = wrapper.find('.settingsSheet')
      expect(dialog.exists()).toBe(true)
      expect(dialog.attributes('role')).toBe('dialog')
      expect(dialog.attributes('aria-modal')).toBe('true')
    })

    it('renders every settings group header', () => {
      const wrapper = mountSheet()
      const headers = wrapper.findAll('.settingsHeader').map(h => h.text())
      expect(headers).toEqual(expect.arrayContaining([
        'Appearance', 'Experience', 'Features', 'Personal Records',
        'Filters', 'Intensity Presets', 'Exercises', 'Gyms', 'Weight Goal', 'Data',
        'Support', 'Legal',
      ]))
    })
  })

  describe('appearance — mode & units', () => {
    it('sets the color mode and logs the change when a mode button is tapped', async () => {
      const wrapper = mountSheet()
      const lightBtn = wrapper.find('button[aria-label="Light mode"]')
      await lightBtn.trigger('click')
      expect(mockColorMode.value).toBe('light')
      expect(mockLogEvent).toHaveBeenCalledWith('mode_toggle', { mode: 'light' })
    })

    it('reflects the active mode via aria-pressed', () => {
      const wrapper = mountSheet()
      const darkBtn = wrapper.find('button[aria-label="Dark mode"]')
      expect(darkBtn.attributes('aria-pressed')).toBe('true')
    })

    it('switches the weight unit when kg is tapped', async () => {
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="Use kilograms"]').trigger('click')
      expect(mockWeightUnit.value).toBe('kg')
    })
  })

  describe('experience toggles', () => {
    it('flips a haptics toggle through the preferences store', async () => {
      const wrapper = mountSheet()
      const toggle = wrapper.find('button[aria-label="Disable haptics"]')
      expect(toggle.attributes('role')).toBe('switch')
      expect(toggle.attributes('aria-checked')).toBe('true')
      await toggle.trigger('click')
      expect(mockSetExperienceFlag).toHaveBeenCalledWith('haptics', false)
      expect(mockLogEvent).toHaveBeenCalledWith('experience_toggle', { key: 'haptics', enabled: false })
    })

    it('flips PR celebrations off through the store', async () => {
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="Disable PR celebrations"]').trigger('click')
      expect(mockSetExperienceFlag).toHaveBeenCalledWith('prCelebrations', false)
    })

    it('enables the rest timer via the composable ref', async () => {
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="Enable rest timer"]').trigger('click')
      expect(mockRestTimerEnabled.value).toBe(true)
    })
  })

  describe('feature toggles', () => {
    it('toggles a feature tab through the preferences store', async () => {
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="Disable Calendar"]').trigger('click')
      expect(mockToggleFeature).toHaveBeenCalledWith('calendar')
    })

    it('disables the last-enabled feature toggle to guarantee one tab stays on', () => {
      mockPrefs.features = { workouts: true, calendar: false, weight: false }
      mockPrefs.enabledCount = 1
      const wrapper = mountSheet()
      const workoutsToggle = wrapper.find('button[aria-label="Disable Workouts"]')
      expect(workoutsToggle.attributes('disabled')).toBeDefined()
    })
  })

  describe('filters', () => {
    it('writes the warmup threshold back to the store on range input', async () => {
      const wrapper = mountSheet()
      const range = wrapper.find('input.settingsRange')
      ;(range.element as HTMLInputElement).value = '60'
      await range.trigger('input')
      expect(mockSetWarmupThreshold).toHaveBeenCalledWith(0.6)
    })
  })

  describe('intensity presets', () => {
    it('renders a stepper row per configured preset', () => {
      const wrapper = mountSheet()
      expect(wrapper.findAll('.settingsPresetRow')).toHaveLength(5)
    })

    it('adds a preset through the store when + Add preset is tapped', async () => {
      const wrapper = mountSheet()
      await wrapper.find('.settingsPresetAdd').trigger('click')
      expect(mockSetIntensityPresets).toHaveBeenCalled()
    })

    it('deletes a preset through the store', async () => {
      const wrapper = mountSheet()
      await wrapper.find('.settingsPresetDelete').trigger('click')
      expect(mockSetIntensityPresets).toHaveBeenCalled()
    })
  })

  // #1272 — a lifter deep in a cut can't beat a peak-bulk PR, so this group
  // chooses what "your best" is measured against. The two controls interact
  // (the manual anchor still shadows the window when it is the later of the
  // two), so the hint has to state the resolved answer, not just echo the mode.
  describe('strength baseline mode (#1272)', () => {
    function segment(wrapper: VueWrapper, label: string) {
      return wrapper.findAll('.settingsSegmentBtn').find(b => b.text() === label)
    }

    it('defaults to Lifetime and hides the recent-window stepper', () => {
      const wrapper = mountSheet()
      expect(segment(wrapper, 'Lifetime')!.attributes('aria-pressed')).toBe('true')
      expect(segment(wrapper, 'Recent')!.attributes('aria-pressed')).toBe('false')
      expect(wrapper.find('button[aria-label="Lengthen recent window"]').exists()).toBe(false)
    })

    it('switches the mode through the composable and logs the change', async () => {
      const wrapper = mountSheet()
      await segment(wrapper, 'Recent')!.trigger('click')
      expect(mockSetStrengthBaselineMode).toHaveBeenCalledWith('recent')
      expect(mockLogEvent).toHaveBeenCalledWith('strength_baseline_mode', { mode: 'recent' })
    })

    it('reveals the window stepper only in recent mode', async () => {
      const wrapper = mountSheet()
      await segment(wrapper, 'Recent')!.trigger('click')
      expect(wrapper.find('button[aria-label="Lengthen recent window"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('8 weeks')
    })

    it('steps the window by whole increments through the composable', async () => {
      mockStrengthBaselineMode.value = 'recent'
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="Lengthen recent window"]').trigger('click')
      expect(mockSetRecentBaselineWeeks).toHaveBeenCalledWith(10)
      await wrapper.find('button[aria-label="Shorten recent window"]').trigger('click')
      expect(mockSetRecentBaselineWeeks).toHaveBeenLastCalledWith(8)
    })

    it('disables the stepper at each end of the range', async () => {
      mockStrengthBaselineMode.value = 'recent'
      mockRecentBaselineWeeks.value = 2
      const wrapper = mountSheet()
      expect(wrapper.find('button[aria-label="Shorten recent window"]').attributes('disabled')).toBeDefined()
      mockRecentBaselineWeeks.value = 26
      await nextTick()
      expect(wrapper.find('button[aria-label="Lengthen recent window"]').attributes('disabled')).toBeDefined()
    })

    it('states the baseline actually in force, not just the mode', async () => {
      const wrapper = mountSheet()
      expect(wrapper.text()).toContain('Your best ever')

      mockPrBaselineAnchor.value = '2025-01-01'
      await nextTick()
      expect(wrapper.text()).toContain('Your best since')

      mockStrengthBaselineMode.value = 'recent'
      await nextTick()
      // The 2025 anchor is far outside the 8-week window, so the window wins.
      expect(wrapper.text()).toContain('Your best in the last 8 weeks')
    })

    it('reports the anchor, not the window, when a fresh block is the tighter floor', async () => {
      mockStrengthBaselineMode.value = 'recent'
      // 10 days before MOCK_TODAY — newer than the 8-week window start, so the
      // effective window is shorter than the stepper says and the copy must not
      // claim "the last 8 weeks".
      mockPrBaselineAnchor.value = '2026-08-20'
      const wrapper = mountSheet()
      expect(wrapper.text()).toContain('newer than the 8-week window')
      expect(wrapper.text()).not.toContain('Your best in the last 8 weeks')
    })

    it('does not label an unset anchor "All time" while a recent window is in force', async () => {
      const wrapper = mountSheet()
      expect(wrapper.text()).toContain('All time')

      mockStrengthBaselineMode.value = 'recent'
      await nextTick()
      expect(wrapper.text()).not.toContain('All time')
      expect(wrapper.text()).toContain('Not set')
    })

    it('binds the date input to the raw anchor, not the resolved baseline', async () => {
      mockStrengthBaselineMode.value = 'recent'
      const wrapper = mountSheet()
      // Recent mode resolves to a rolling window; the input must keep showing
      // the user's own anchor (empty here) so editing it doesn't silently
      // overwrite it with a derived date.
      const input = wrapper.find('input[aria-label="PR baseline date"]')
      expect(input.attributes('value')).toBe('')
      expect(wrapper.find('button[aria-label="Clear PR baseline (use all time)"]').exists()).toBe(false)

      mockPrBaselineAnchor.value = '2026-01-01'
      await nextTick()
      expect(wrapper.find('input[aria-label="PR baseline date"]').attributes('value')).toBe('2026-01-01')
    })
  })

  describe('weight goal', () => {
    it('sets the goal direction through the store', async () => {
      const wrapper = mountSheet()
      const gainBtn = wrapper.findAll('.settingsSegmentBtn').find(b => b.text() === 'Gaining')
      await gainBtn!.trigger('click')
      expect(mockSetWeightGoalDirection).toHaveBeenCalledWith('gain')
    })
  })

  describe('data section', () => {
    it('renders export, import, and report controls', () => {
      const wrapper = mountSheet()
      expect(wrapper.find('button[aria-label="Export data as CSV"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Export data as JSON"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Import workout data from CSV"]').exists()).toBe(true)
      expect(wrapper.find('button[aria-label="Generate training report"]').exists()).toBe(true)
    })

    it('switches the active report period on tap', async () => {
      const wrapper = mountSheet()
      await wrapper.find('button[aria-label="year training report"]').trigger('click')
      // Re-query after the re-render — the held wrapper node goes stale.
      expect(wrapper.find('button[aria-label="year training report"]').attributes('aria-pressed')).toBe('true')
    })
  })

  describe('gym manager modal', () => {
    it('opens the gym manager when Manage Gyms is tapped', async () => {
      const wrapper = mountSheet()
      expect(wrapper.find('.gym-stub').attributes('data-open')).toBe('false')
      const manageBtn = wrapper.findAll('.settingsRowBtn').find(b => b.text().includes('Manage Gyms'))
      expect(manageBtn).toBeTruthy()
      await manageBtn!.trigger('click')
      expect(wrapper.find('.gym-stub').attributes('data-open')).toBe('true')
    })
  })

  describe('exercise manager modal (#1252)', () => {
    it('opens the exercise manager when Manage Exercises is tapped', async () => {
      const wrapper = mountSheet()
      expect(wrapper.find('.exercise-stub').attributes('data-open')).toBe('false')
      const manageBtn = wrapper.findAll('.settingsRowBtn').find(b => b.text().includes('Manage Exercises'))
      expect(manageBtn).toBeTruthy()
      await manageBtn!.trigger('click')
      expect(wrapper.find('.exercise-stub').attributes('data-open')).toBe('true')
    })

    it('feeds it the synced gym list and every known tag', () => {
      mockPrefs.gyms = ['Gym A', 'Gym B']
      mockWorkoutStore.allTags = ['Chest', 'Triceps']
      const wrapper = mountSheet()
      const stub = wrapper.find('.exercise-stub')
      expect(stub.attributes('data-gyms')).toBe('Gym A,Gym B')
      expect(stub.attributes('data-tags')).toBe('Chest,Triceps')
    })

    it('routes tag toggles to the store and gym toggles to useGymActions', async () => {
      const wrapper = mountSheet()
      const stub = wrapper.findComponent(ExerciseManagerModalStub)
      stub.vm.$emit('toggle-exercise-tag', 'e1', 'Chest')
      stub.vm.$emit('toggle-exercise-gym', 'e1', 'Gym A')
      await wrapper.vm.$nextTick()
      expect(mockToggleExerciseTag).toHaveBeenCalledWith('e1', 'Chest')
      expect(mockToggleExerciseGym).toHaveBeenCalledWith('e1', 'Gym A')
    })
  })

  describe('legal + danger surfaces', () => {
    it('opens the privacy policy view', async () => {
      const wrapper = mountSheet()
      const privacyBtn = wrapper.findAll('.settingsRowBtn').find(b => b.text() === 'Privacy Policy')
      await privacyBtn!.trigger('click')
      expect(wrapper.find('.legal-stub').attributes('data-view')).toBe('privacy')
    })

    it('opens the terms of service view', async () => {
      const wrapper = mountSheet()
      const termsBtn = wrapper.findAll('.settingsRowBtn').find(b => b.text() === 'Terms of Service')
      await termsBtn!.trigger('click')
      expect(wrapper.find('.legal-stub').attributes('data-view')).toBe('terms')
    })

    it('confirms sign out and emits sign-out + close', async () => {
      const wrapper = mountSheet()
      await wrapper.find('.settingsSignOut').trigger('click')
      const confirmBtn = wrapper.find('.confirmBtnConfirm')
      expect(confirmBtn.exists()).toBe(true)
      await confirmBtn.trigger('click')
      expect(wrapper.emitted('sign-out')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.some(e => e[0] === false)).toBe(true)
    })

    it('opens the delete-account confirmation dialog', async () => {
      const wrapper = mountSheet()
      await wrapper.find('.settingsDeleteAccount').trigger('click')
      expect(wrapper.find('.deleteConfirmSheet').exists()).toBe(true)
      expect(mockLogEvent).toHaveBeenCalledWith('delete_account_opened')
    })
  })

  // ── Guest copy (LIFT-1310) ───────────────────────────────────────
  // The BEHAVIOUR already forked for a guest — App.vue routes their sign-out to
  // exitGuestMode() (data intact) and LIFT-1301 skips the server stages of
  // deleteAccount() — but this sheet had no `isGuest` conditional anywhere, so
  // every account-shaped string named something a guest does not have. Two of
  // them were affirmatively false: "You will not be able to sign back in" (a
  // guest lands on the auth gate and can tap "Continue as guest" again), and
  // "Synced over encrypted HTTPS" (nothing a guest logs ever leaves the device
  // — the app's own guest banner says the opposite on the tab behind this one).
  //
  // Nothing caught it because this file had never mounted the sheet as a guest,
  // the same blind spot that let LIFT-1301 ship: useAuth.test.ts's deleteAccount
  // block only ever called devSignIn(). Each assertion below is paired with its
  // signed-in twin, since a fork is only pinned from both sides.
  describe('guest mode copy (LIFT-1310)', () => {
    it('offers to exit guest mode rather than sign out of a session', () => {
      continueAsGuest()
      expect(mountSheet().find('.settingsSignOut').text()).toBe('Exit Guest Mode')
    })

    it('still says Sign Out for a real session', () => {
      signIn()
      expect(mountSheet().find('.settingsSignOut').text()).toBe('Sign Out')
    })

    it('promises the guest their workouts survive leaving', async () => {
      continueAsGuest()
      const wrapper = mountSheet()
      await wrapper.find('.settingsSignOut').trigger('click')
      expect(wrapper.find('#confirm-msg').text())
        .toBe('Exit guest mode? Your workouts stay on this device.')
    })

    it('keeps the bare Sign out? confirm for a real session', async () => {
      signIn()
      const wrapper = mountSheet()
      await wrapper.find('.settingsSignOut').trigger('click')
      expect(wrapper.find('#confirm-msg').text()).toBe('Sign out?')
    })

    it('leaves the sign-out emit untouched — App.vue owns the guest fork', async () => {
      continueAsGuest()
      const wrapper = mountSheet()
      await wrapper.find('.settingsSignOut').trigger('click')
      await wrapper.find('.confirmBtnConfirm').trigger('click')
      expect(wrapper.emitted('sign-out')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.some(e => e[0] === false)).toBe(true)
    })

    it('names the danger-zone row for what it deletes, not an account', () => {
      continueAsGuest()
      expect(mountSheet().find('.settingsDeleteAccount .settingsLabel').text())
        .toBe('Delete All Data')
    })

    it('still names it Delete Account for a real session', () => {
      signIn()
      expect(mountSheet().find('.settingsDeleteAccount .settingsLabel').text())
        .toBe('Delete Account')
    })

    it('drops the account and sign-back-in clauses from the delete dialog', async () => {
      continueAsGuest()
      const wrapper = mountSheet()
      await wrapper.find('.settingsDeleteAccount').trigger('click')
      expect(wrapper.find('.deleteConfirmTitle').text()).toBe('Delete All Data')
      const desc = wrapper.find('.deleteConfirmDesc').text()
      expect(desc).not.toMatch(/account/i)
      expect(desc).not.toMatch(/sign back in/i)
      // The irreversibility is the part that IS true for a guest — keep it.
      expect(desc).toMatch(/cannot be undone/i)
      expect(desc).toMatch(/from this device/i)
    })

    // The title is the alertdialog's accessible name (aria-labelledby), so a
    // drift from the row would announce a different action than the one just
    // tapped. Both now read from one computed — this pins that they agree.
    it('announces the dialog with the same label as the row that opened it', async () => {
      continueAsGuest()
      const guest = mountSheet()
      await guest.find('.settingsDeleteAccount').trigger('click')
      expect(guest.find('.deleteConfirmTitle').text())
        .toBe(guest.find('.settingsDeleteAccount .settingsLabel').text())
      guest.unmount()

      signIn()
      const member = mountSheet()
      await member.find('.settingsDeleteAccount').trigger('click')
      expect(member.find('.deleteConfirmTitle').text())
        .toBe(member.find('.settingsDeleteAccount .settingsLabel').text())
    })

    it('keeps the account wording in the delete dialog for a real session', async () => {
      signIn()
      const wrapper = mountSheet()
      await wrapper.find('.settingsDeleteAccount').trigger('click')
      expect(wrapper.find('.deleteConfirmTitle').text()).toBe('Delete Account')
      expect(wrapper.find('.deleteConfirmDesc').text()).toMatch(/not be able to sign back in/i)
    })

    // The gate stays for a guest deliberately: this is the ONLY path a guest has
    // to erase their device, and it is exactly as irreversible as an account
    // deletion. Softer copy must not become a softer confirmation.
    it('holds a guest to the same DELETE-to-confirm gate', async () => {
      continueAsGuest()
      const wrapper = mountSheet()
      await wrapper.find('.settingsDeleteAccount').trigger('click')
      const deleteBtn = wrapper.find('.deleteConfirmBtn')
      expect(deleteBtn.attributes('disabled')).toBeDefined()

      await wrapper.find('.deleteConfirmInput').setValue('delete')
      expect(wrapper.find('.deleteConfirmBtn').attributes('disabled')).toBeDefined()

      await wrapper.find('.deleteConfirmInput').setValue('DELETE')
      expect(wrapper.find('.deleteConfirmBtn').attributes('disabled')).toBeUndefined()
      await wrapper.find('.deleteConfirmBtn').trigger('click')
      expect(mockDeleteAccount).toHaveBeenCalled()
    })

    it('does not claim a guest is synced — the sentinel user is truthy', () => {
      continueAsGuest()
      const rows = mountSheet().findAll('.privacyText').map(r => r.text())
      expect(rows).toContain('Sign in to sync across devices')
      expect(rows).not.toContain('Synced over encrypted HTTPS')
    })

    it('does claim sync for a real session', () => {
      signIn()
      const rows = mountSheet().findAll('.privacyText').map(r => r.text())
      expect(rows).toContain('Synced over encrypted HTTPS')
    })
  })

  // ── Close path ───────────────────────────────────────────────────
  // Regression: closeSettings() used to emit the close from a bare one-shot
  // `animationend` listener, so `modelValue` only cleared if that event
  // arrived. Background the PWA mid-close (iOS freezes animations on a hidden
  // page) and it never did — App's `settingsOpen` stayed true with the sheet
  // parked off-screen by `animation-fill-mode: forwards`, and the gear button
  // (`settingsOpen ? closeSettings() : (settingsOpen = true)`) could only ever
  // re-enter closeSettings(). Re-adding an already-present class does not
  // restart a CSS animation, so no further event was coming: settings refused
  // to open until a full reload.
  //
  // These were never caught because the only close assertion in this suite went
  // through the sign-out path, which emits synchronously — and jsdom never
  // dispatches `animationend` on its own, so an animation-gated state change is
  // invisible to the suite by construction. Each test below drives that event
  // explicitly (or withholds it) to pin the contract.
  describe('closing', () => {
    /** jsdom's AnimationEvent support is patchy — build the event by hand. */
    function animationEnd(animationName: string): Event {
      const e = new Event('animationend', { bubbles: true })
      Object.defineProperty(e, 'animationName', { value: animationName })
      return e
    }
    const close = (wrapper: VueWrapper) =>
      (wrapper.vm as unknown as { closeSettings: () => void }).closeSettings()
    const closeEmits = (wrapper: VueWrapper) =>
      (wrapper.emitted('update:modelValue') ?? []).filter(e => e[0] === false)

    afterEach(() => {
      vi.useRealTimers()
    })

    it('still closes when animationend never fires', () => {
      vi.useFakeTimers()
      const wrapper = mountSheet()
      close(wrapper)
      // The animation is never allowed to complete — the sheet must not be
      // able to strand the app in a permanently-open state.
      expect(closeEmits(wrapper)).toHaveLength(0)
      vi.advanceTimersByTime(250)
      expect(closeEmits(wrapper)).toHaveLength(1)
    })

    it('closes as soon as the slide-down animation ends, and only once', () => {
      vi.useFakeTimers()
      const wrapper = mountSheet()
      const sheet = wrapper.find('.settingsSheet').element
      close(wrapper)
      expect(sheet.classList.contains('settingsSheetClosing')).toBe(true)

      sheet.dispatchEvent(animationEnd('sheetSlideDown'))
      expect(closeEmits(wrapper)).toHaveLength(1)

      // The fallback timer must not fire a second close behind the event.
      vi.advanceTimersByTime(500)
      expect(closeEmits(wrapper)).toHaveLength(1)
    })

    it('ignores animationend bubbling up from a descendant', () => {
      vi.useFakeTimers()
      const wrapper = mountSheet()
      const sheet = wrapper.find('.settingsSheet').element
      close(wrapper)

      // `animationend` bubbles: any animated descendant inside the sheet would
      // otherwise satisfy the one-shot listener and close it out from under the
      // user, mid slide-down.
      const descendant = sheet.querySelector('.settingsScrollBody')!
      descendant.dispatchEvent(animationEnd('sheetSlideDown'))
      expect(closeEmits(wrapper)).toHaveLength(0)

      // A different animation on the sheet itself is likewise not our cue.
      sheet.dispatchEvent(animationEnd('sheetSlideUp'))
      expect(closeEmits(wrapper)).toHaveLength(0)

      sheet.dispatchEvent(animationEnd('sheetSlideDown'))
      expect(closeEmits(wrapper)).toHaveLength(1)
    })

    it('is idempotent while a close is already in flight', () => {
      vi.useFakeTimers()
      const wrapper = mountSheet()
      const sheet = wrapper.find('.settingsSheet').element
      // Tapping the gear repeatedly during the 150ms animation must not queue
      // extra closes — `classList.add` of a present class does not restart the
      // animation, so re-registering listeners would strand them.
      close(wrapper)
      close(wrapper)
      close(wrapper)
      sheet.dispatchEvent(animationEnd('sheetSlideDown'))
      vi.advanceTimersByTime(500)
      expect(closeEmits(wrapper)).toHaveLength(1)
    })

    it('closes immediately when the sheet element was never captured', () => {
      const wrapper = mountSheet(false)
      // modelValue false → no sheet element, so there is nothing to animate.
      // (Guarded early-return; the close is a no-op rather than a strand.)
      close(wrapper)
      expect(closeEmits(wrapper)).toHaveLength(0)
    })
  })

  describe('supporter funnel (LIFT-906)', () => {
    it('does not log an impression until the Support group scrolls into view', async () => {
      // App.vue mounts the sheet already-open (#955), but the Support group is
      // 12th of 14 groups — firing on open counted a mostly-unseen CTA. The
      // impression must wait for the group to actually enter the viewport.
      mountSheet(true)
      await nextTick()
      expect(mockSupportFunnel).not.toHaveBeenCalled()

      // The visibility observer for the Support group is the latest one armed.
      lastIntersectionObserver().trigger(true)
      expect(mockSupportFunnel).toHaveBeenCalledWith('impression')
      expect(mockSupportFunnel).toHaveBeenCalledTimes(1)
    })

    it('logs the impression only once even if the group re-enters view', async () => {
      mountSheet(true)
      await nextTick()
      const observer = lastIntersectionObserver()
      observer.trigger(true)
      observer.trigger(true) // scrolled away and back within the same open
      expect(mockSupportFunnel).toHaveBeenCalledTimes(1)
    })

    it('logs no impression when mounted closed', async () => {
      mountSheet(false)
      await nextTick()
      expect(mockIntersectionObservers).toHaveLength(0)
      expect(mockSupportFunnel).not.toHaveBeenCalled()
    })

    it('taps still report the CTA regardless of the impression gate', () => {
      const wrapper = mountSheet(true)
      wrapper.find('a[href="https://github.com/sponsors/aschung212"]').trigger('click')
      expect(mockSupportFunnel).toHaveBeenCalledWith('tap', { cta: 'github_sponsors' })
    })
  })

  describe('support-funding transparency (LIFT-1203)', () => {
    it('states what supporter dollars fund alongside the CTAs', () => {
      const wrapper = mountSheet(true)
      const note = wrapper.find('.settingsGroupNote')
      expect(note.exists()).toBe(true)
      const text = note.text()
      expect(text).toContain('AI Coach')
      expect(text).toContain('sync server')
      // Reinforces the existing "no ads / no data sales" trust promise.
      expect(text).toMatch(/ad-free/i)
      expect(text).toMatch(/never sells your data/i)
    })
  })

  // ── Background-scroll lock (#830) ────────────────────────────────
  //
  // The settings sheet is a full-screen bottom sheet, but it used raw
  // useFocusTrap and never took the lock at all — the page stayed scrollable
  // behind it. It now goes through useModal, so it participates in the SAME
  // reference count as every other modal instead of owning a boolean.
  describe('background-scroll lock (#830)', () => {
    const isLocked = () => document.documentElement.classList.contains('modal-open')

    // A stand-in for any other useModal-based surface (WorkoutTracker's log
    // sheet, CalendarView's set editor, …) holding the shared lock too.
    const ForeignModalHost = defineComponent({
      setup: () => ({ modal: useModal() }),
      template: '<div />',
    })
    type ForeignHost = { modal: ReturnType<typeof useModal> }
    const foreign = (w: VueWrapper) => (w.vm as unknown as ForeignHost).modal

    it('locks background scroll while the sheet is open', async () => {
      expect(isLocked()).toBe(false)
      // App.vue mounts this with `v-if="settingsOpen"` (#955), so the sheet
      // arrives already-open — the lock has to be taken on mount, not on a
      // false→true prop transition that never happens.
      const wrapper = mountSheet(true)
      expect(isLocked()).toBe(true)

      await wrapper.setProps({ modelValue: false })
      expect(isLocked()).toBe(false)
    })

    it('does not lock when it is mounted closed', () => {
      mountSheet(false)
      expect(isLocked()).toBe(false)
    })

    it('keeps the lock applied when it closes under another modal', async () => {
      const other = mount(ForeignModalHost)
      foreign(other).open()

      const wrapper = mountSheet(true)
      expect(isLocked()).toBe(true)

      await wrapper.setProps({ modelValue: false })
      // The regression this guards: a boolean `modal-open` toggle here would
      // unlock the background under the still-open foreign modal.
      expect(isLocked()).toBe(true)

      foreign(other).close()
      expect(isLocked()).toBe(false)
    })

    it('releases its lock on unmount — App.vue closes it by tearing it down', () => {
      const other = mount(ForeignModalHost)
      foreign(other).open()

      const wrapper = mountSheet(true)
      // `v-if="settingsOpen"` unmounts the sheet on close, so the prop watcher
      // never sees false — useModal's onUnmounted safety net is the only thing
      // that releases the lock on the real close path.
      wrapper.unmount()
      expect(isLocked()).toBe(true)

      foreign(other).close()
      expect(isLocked()).toBe(false)
    })
  })
})
