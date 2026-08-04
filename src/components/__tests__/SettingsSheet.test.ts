import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, reactive } from 'vue'
import { mount, VueWrapper } from '@vue/test-utils'

// SettingsSheet is one of the two "god components" in the repo (the other,
// WorkoutTracker, is already covered). It owns theme switching, the weight-unit
// toggle, every experience/feature toggle, weekly-goal config, PR baseline,
// intensity presets, data export/report/import, gym management, and the
// support/legal/danger-zone rows — all high-churn state that regresses
// silently. This suite mounts it with the stores/composables mocked (mirroring
// WorkoutTracker.test.ts) and asserts toggle→store wiring plus modal open/close.

// ── Analytics (stable spy so we can assert logged events) ──────────
const mockLogEvent = vi.fn()
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: mockLogEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }),
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

// ── PR baseline ────────────────────────────────────────────────────
const mockSetPRBaseline = vi.fn()
const mockStartNewTrainingBlock = vi.fn()
const mockClearPRBaseline = vi.fn()
vi.mock('../../composables/usePRBaseline', () => ({
  usePRBaseline: () => ({
    prBaselineDate: ref(null),
    setPRBaseline: mockSetPRBaseline,
    startNewTrainingBlock: mockStartNewTrainingBlock,
    clearPRBaseline: mockClearPRBaseline,
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
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    exercises: [],
    workoutDates: [],
    addExercise: vi.fn(),
    logSet: vi.fn(),
    renameGymOnExercises: vi.fn(),
    removeGymFromExercises: vi.fn(() => []),
  }),
}))
vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({
    entries: [],
    sortedEntries: [],
    latestWeight: null,
  }),
}))

// ── Auth (Sign Out / Delete Account) ───────────────────────────────
const mockDeleteAccount = vi.fn().mockResolvedValue(undefined)
vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({ user: ref(null), deleteAccount: mockDeleteAccount }),
}))

// ── XP ceremony, app share, gym actions — no-op surfaces ───────────
vi.mock('../../composables/useXPCeremony', () => ({
  useXPCeremony: () => ({ celebrateUnlocks: vi.fn() }),
}))
const mockShareApp = vi.fn().mockResolvedValue({ kind: 'shared' })
vi.mock('../../composables/useAppShare', () => ({
  useAppShare: () => ({ shareApp: mockShareApp, isSharing: ref(false), lastError: ref(null) }),
}))
vi.mock('../../composables/useGymActions', () => ({
  useGymActions: () => ({
    createGym: vi.fn(),
    renameGym: vi.fn(),
    deleteGym: vi.fn(),
    toggleExerciseGym: vi.fn(),
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

function mountSheet(open = true): VueWrapper {
  return mount(SettingsSheet, {
    props: { modelValue: open },
    global: {
      stubs: {
        Teleport: true,
        LegalSheet: LegalSheetStub,
        ThemeStatsSheet: true,
        GymManagerModal: GymManagerModalStub,
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
    mockPrefs.weightGoal = { direction: 'maintain', maintainMin: null, maintainMax: null, loseTarget: null, gainTarget: null }
    mockProgression.progressionEnabled = false
    vi.clearAllMocks()
  })

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
        'Filters', 'Intensity Presets', 'Gyms', 'Weight Goal', 'Data',
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
})
