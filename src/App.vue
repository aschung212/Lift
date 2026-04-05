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
            <div class="sheetDragHandle" ref="settingsHandleEl" aria-hidden="true"><span class="sheetDragPill"></span></div>
            <div class="settingsScrollBody">

            <div class="settingsGroup">
              <div class="settingsHeader" id="settings-title">Appearance</div>
              <!-- Badge case: verbose mode header (only when progression is active) -->
              <div v-if="progressionActive && progressionStore.showProgression" class="badgeCaseHeader">
                <template v-if="progressionStore.nextUnlockThreshold !== null">
                  <span class="badgeCaseXP">{{ progressionStore.totalXP.toLocaleString() }} / {{ progressionStore.nextUnlockThreshold.toLocaleString() }} XP</span>
                  <span v-if="progressionStore.streakWeeks > 0" class="badgeCaseStreak">{{ progressionStore.streakWeeks }}w streak · {{ progressionStore.currentMultiplier }}x</span>
                </template>
                <span v-else class="badgeCaseXP">Lifetime: {{ progressionStore.totalXP.toLocaleString() }} XP</span>
              </div>
              <div class="settingsThemeGrid">
                <button
                  v-for="t in sortedThemes"
                  :key="t.id"
                  :class="['themePreview', { active: currentTheme === t.id, locked: !isThemeUnlocked(t.id), mystery: isEternalLocked(t.id) }]"
                  @click="currentTheme === t.id ? openThemeStats(t.id) : isThemeUnlocked(t.id) ? selectTheme(t.id) : isEternalLocked(t.id) ? showEternalHint() : handleThemePreview(t.id)"
                  :aria-label="isEternalLocked(t.id) ? 'Mystery theme — 1,000,000 XP' : isThemeUnlocked(t.id) ? 'Select ' + t.label + ' theme' : t.label + ' theme — locked'"
                  :aria-pressed="currentTheme === t.id"
                >
                  <span
                    :class="['themePreviewDot', { mysteryDot: isEternalLocked(t.id), trialDot: progressionActive && !progressionStore.starterConfirmed && isStarterTheme(t.id) && isThemeUnlocked(t.id) }]"
                    :style="isEternalLocked(t.id) ? {} : {
                      background: 'linear-gradient(135deg, ' + THEME_PREVIEWS[t.id]?.[resolvedMode]?.accent + ', ' + THEME_PREVIEWS[t.id]?.[resolvedMode]?.bg + ')',
                    }"
                  >
                    <svg v-if="t.icon === 'fire'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 23c-4.97 0-8-3.03-8-7 0-2.5 1.5-5 3-6.5.5-.5 1.37-.18 1.37.54 0 1.3.6 2.46 1.63 3.2.2.14.46-.05.38-.28-.5-1.46-.63-3.1-.08-4.96C11.5 4.5 14 2 16 1c.4-.2.82.18.68.6C15.5 5.5 17 7 18 8.5c2 3 2 5 2 6.5 0 3.97-3.03 8-8 8z"/></svg>
                    <svg v-else-if="t.icon === 'water'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2 15c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 19c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 11c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    <svg v-else-if="t.icon === 'luck'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 3C12 3 9 6 9 8.5c0 1.4.7 2.6 1.8 3.2L12 12l1.2-.3C14.3 11.1 15 9.9 15 8.5 15 6 12 3 12 3z"/><path d="M21 12c0 0-3-3-5.5-3-1.4 0-2.6.7-3.2 1.8L12 12l.3 1.2c.6 1.1 1.8 1.8 3.2 1.8C18 15 21 12 21 12z"/><path d="M12 21c0 0 3-3 3-5.5 0-1.4-.7-2.6-1.8-3.2L12 12l-1.2.3C9.7 12.9 9 14.1 9 15.5 9 18 12 21 12 21z"/><path d="M3 12c0 0 3 3 5.5 3 1.4 0 2.6-.7 3.2-1.8L12 12l-.3-1.2C11.1 9.7 9.9 9 8.5 9 6 9 3 12 3 12z"/></svg>
                    <svg v-else-if="t.icon === 'air'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    <span v-else-if="t.icon === 'eternal' && isEternalLocked(t.id)" class="mysteryIcon">?</span>
                    <svg v-else-if="t.icon === 'eternal'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z"/></svg>
                    <svg v-else-if="t.icon === 'amethyst'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2L4 9l8 13 8-13-8-7zm0 3.5L7.5 9.5 12 17l4.5-7.5L12 5.5z"/></svg>
                    <svg v-else-if="t.icon === 'sun'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    <svg v-else-if="t.icon === 'midnight'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    <svg v-else-if="t.icon === 'love'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    <svg v-else-if="t.icon === 'pearl'" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><circle cx="12" cy="12" r="8" opacity="0.3"/><circle cx="12" cy="12" r="6"/><circle cx="9.5" cy="9.5" r="2" opacity="0.4" fill="white"/></svg>
                    <svg v-else-if="t.icon === 'earth'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M2 20L8 8l4 6 3-4 5 10" fill="currentColor" opacity="0.25"/><path d="M2 20L8 8l4 6 3-4 5 10"/></svg>
                    <!-- Lock icon for locked themes -->
                    <svg v-if="!isThemeUnlocked(t.id)" class="themePreviewLock" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    <!-- Checkmark for active unlocked theme -->
                    <svg v-else-if="currentTheme === t.id" class="themePreviewCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>
                  <span class="themePreviewLabel">{{ isEternalLocked(t.id) ? '???' : t.label }}</span>
                </button>
              </div>
              <!-- Trial period banner -->
              <div v-if="progressionActive && !progressionStore.starterConfirmed" class="trialBanner">
                Trying starters — log a set to lock in your choice
              </div>
              <!-- XP to unlock overlay for previewed locked theme -->
              <div v-if="previewingThemeId && !isThemeUnlocked(previewingThemeId) && progressionActive" class="badgePreviewOverlay">
                {{ xpToUnlockPreview.toLocaleString() }} XP to unlock
              </div>
              <div v-else-if="previewingThemeId && !isThemeUnlocked(previewingThemeId) && !progressionActive" class="badgePreviewOverlay" style="cursor:pointer" @click="scrollToProgressionToggle">
                Enable Progression to unlock
              </div>
              <!-- Prompt to enable progression when off and locked themes visible -->
              <p v-if="!progressionActive && !previewingThemeId" class="badgeEnableHint" @click="scrollToProgressionToggle">
                Unlock more themes by enabling <span class="badgeEnableLink">Progression</span> below.
              </p>
              <!-- Progress bar toward next unlock (verbose mode only, active progression, not when all unlocked) -->
              <div v-if="progressionActive && progressionStore.showProgression && progressionStore.nextUnlockThreshold !== null" class="badgeProgressBar">
                <div class="badgeProgressFill" :style="{ width: progressionStore.progressPercent + '%' }"></div>
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
              <div v-show="restTimerEnabled" class="settingsRow">
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
              <div ref="progressionToggleEl" class="settingsRow">
                <span class="settingsLabel">Progression</span>
                <button
                  :class="['glassToggle', { on: progressionActive }]"
                  @click="toggleProgression"
                  role="switch"
                  :aria-checked="progressionActive"
                  :aria-label="progressionActive ? 'Disable progression' : 'Enable progression'"
                >
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
              <div v-show="progressionActive" class="settingsRow">
                <span class="settingsLabel settingsLabelIndented">Show XP &amp; streaks</span>
                <button
                  :class="['glassToggle', { on: progressionStore.showProgression }]"
                  @click="progressionStore.setShowProgression(!progressionStore.showProgression)"
                  role="switch"
                  :aria-checked="progressionStore.showProgression"
                  :aria-label="progressionStore.showProgression ? 'Hide progression info' : 'Show progression info'"
                >
                  <span class="glassToggleThumb"></span>
                </button>
              </div>
              <div v-show="progressionActive" class="settingsRow">
                <div class="settingsLabelGroup settingsLabelIndented">
                  <span class="settingsLabel">Weekly goal</span>
                  <span class="settingsHint">{{ weeklyGoalBonusLabel }}</span>
                </div>
                <div class="iosStepper">
                  <button class="iosStepperBtn" @click="adjustWeeklyTarget(-1)" :disabled="effectiveWeeklyTarget <= 1" aria-label="Decrease weekly goal">−</button>
                  <span class="iosStepperValue">{{ effectiveWeeklyTarget }} day{{ effectiveWeeklyTarget !== 1 ? 's' : '' }}</span>
                  <button class="iosStepperBtn" @click="adjustWeeklyTarget(1)" :disabled="effectiveWeeklyTarget >= 7" aria-label="Increase weekly goal">+</button>
                </div>
              </div>
              <div v-show="progressionActive && progressionStore.pendingTargetChange !== null" class="settingsRow">
                <span class="settingsHint settingsLabelIndented">Currently {{ progressionStore.weeklyTarget }} day{{ progressionStore.weeklyTarget !== 1 ? 's' : '' }} · changes next Monday</span>
              </div>
              <div v-show="progressionActive && progressionStore.pendingTargetChange !== null && progressionStore.pendingTargetChange < progressionStore.weeklyTarget && progressionStore.streakWeeks > 0" class="settingsRow">
                <span class="settingsHint settingsLabelIndented settingsWarning">Your {{ progressionStore.streakWeeks }}-week streak will reset when this change takes effect</span>
              </div>
              <div v-show="progressionActive && effectiveWeeklyTarget >= 7" class="settingsRow">
                <span class="settingsHint settingsLabelIndented">Rest days are critical for recovery. 6 and 7 days earn the same bonus.</span>
              </div>
              <div v-show="progressionActive" class="settingsRow">
                <button class="settingsResetBtn" @click="confirmResetProgress">Reset Progress</button>
              </div>
            </div>

            <!-- Dev tools — only on localhost/LAN -->
            <div v-if="isDev" class="settingsGroup">
              <div class="settingsHeader">Dev Tools</div>
              <div class="devToolsGrid">
                <button class="devBtn" @click="devResetOnboarding">Reset Onboarding</button>
                <button class="devBtn" @click="devSeedProgression(12400)">Seed 12k XP</button>
                <button class="devBtn" @click="devSeedProgression(80000)">Seed 80k XP</button>
                <button class="devBtn" @click="devAddXP(5000)">+5,000 XP</button>
                <button class="devBtn" @click="devRunMigration">Run Migration</button>
                <button class="devBtn devBtnDanger" @click="devClearAll">Clear All Data</button>
              </div>
            </div>

            <div class="settingsGroup">
              <div class="settingsHeader">Weight Goal</div>
              <div class="settingsRow">
                <div class="settingsSegment">
                  <button
                    v-for="goal in WEIGHT_GOALS"
                    :key="goal.id"
                    :class="['settingsSegmentBtn', { active: prefs.weightGoal.direction === goal.id }]"
                    @click="setGoalDirection(goal.id)"
                    :aria-pressed="prefs.weightGoal.direction === goal.id"
                  >{{ goal.label }}</button>
                </div>
              </div>
              <div v-if="!showGoalInput && !prefs.hasAnyGoalValue" class="settingsRow">
                <button
                  class="settingsRevealBtn"
                  @click="showGoalInput = true"
                >+ Set target weight</button>
              </div>
              <template v-else>
                <div v-show="prefs.weightGoal.direction !== 'maintain'" class="settingsRow">
                  <span class="settingsLabel settingsLabelSecondary">Target</span>
                  <div class="settingsInputWrap">
                    <input
                      type="number"
                      inputmode="decimal"
                      autocomplete="off"
                      class="settingsInput"
                      placeholder=" "
                      :value="prefs.currentTarget != null ? displayWeight(prefs.currentTarget) : ''"
                      @change="onTargetWeightInput(($event.target as HTMLInputElement).value)"
                      :aria-label="`Target weight in ${weightUnit}`"
                    />
                    <span class="settingsInputUnit">{{ weightUnit }}</span>
                    <button class="settingsInputClear" @click="clearGoalValues" aria-label="Clear target">×</button>
                  </div>
                </div>
                <div v-show="prefs.weightGoal.direction === 'maintain'" class="settingsRow">
                  <span class="settingsLabel settingsLabelSecondary">Range</span>
                  <div class="settingsRangeWrap">
                    <div class="settingsInputWrap">
                      <input
                        type="number"
                        inputmode="decimal"
                        autocomplete="off"
                        class="settingsInput"
                        placeholder="Min"
                        :value="prefs.weightGoal.maintainMin != null ? displayWeight(prefs.weightGoal.maintainMin) : ''"
                        @change="onMaintainMinInput(($event.target as HTMLInputElement).value)"
                        :aria-label="`Minimum weight in ${weightUnit}`"
                      />
                    </div>
                    <span class="settingsRangeSep">–</span>
                    <div class="settingsInputWrap">
                      <input
                        type="number"
                        inputmode="decimal"
                        autocomplete="off"
                        class="settingsInput"
                        placeholder="Max"
                        :value="prefs.weightGoal.maintainMax != null ? displayWeight(prefs.weightGoal.maintainMax) : ''"
                        @change="onMaintainMaxInput(($event.target as HTMLInputElement).value)"
                        :aria-label="`Maximum weight in ${weightUnit}`"
                      />
                    </div>
                    <span class="settingsInputUnit">{{ weightUnit }}</span>
                    <button class="settingsInputClear" @click="clearGoalValues" aria-label="Clear range">×</button>
                  </div>
                </div>
              </template>
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
              <div class="settingsHeader">Support</div>
              <a class="settingsRow settingsRowBtn settingsLink" href="https://github.com/sponsors/aschung212" target="_blank" rel="noopener">
                <span class="settingsLabel">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                  Sponsor on GitHub
                </span>
                <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
              <a class="settingsRow settingsRowBtn settingsLink" href="https://buymeacoffee.com/aschung212" target="_blank" rel="noopener">
                <span class="settingsLabel">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                  Buy Me a Coffee
                </span>
                <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </a>
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

  <!-- Global XP toast -->
  <Teleport to="body">
    <transition name="xpGlobalFade">
      <div v-if="xpToast.visible" class="xpGlobalToast">
        <div class="xpToastEarned">{{ xpToast.text }}</div>
        <div class="xpToastTotal">{{ xpToast.nextThresholdXP ? `${xpToast.totalXP.toLocaleString()} / ${xpToast.nextThresholdXP.toLocaleString()} XP` : `${xpToast.totalXP.toLocaleString()} XP` }}</div>
        <div v-if="xpToast.nextThresholdXP" class="xpToastProgress">
          <div class="xpToastProgressFill" :style="{ width: xpToast.progressPercent + '%' }"></div>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Progression explainer + starter picker modal -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="starterPickerVisible" class="unlockOverlay">
        <div class="unlockModal">
          <!-- Step 1: Explainer -->
          <template v-if="starterPickerStep === 'explainer'">
            <div class="unlockTitle" style="color: var(--text-primary)">Theme Progression</div>
            <div class="progressionExplainer">
              <div class="explainerRow">Every set you log earns XP</div>
              <div class="explainerRow">Hit PRs for bonus multipliers</div>
              <div class="explainerRow">Earn enough XP to unlock new themes</div>
              <div class="explainerRow">Build streaks for even more XP</div>
            </div>
            <button class="unlockDismiss" @click="starterPickerStep = 'pick'">Pick a Starter Theme</button>
          </template>

          <!-- Step 2: Starter pick -->
          <template v-else>
            <div class="unlockTitle" style="color: var(--text-primary)">Pick Your Starter</div>
            <div class="resetConfirmText">Try all three freely until you log your first set. Then your choice locks in.</div>
            <div class="obStarterGridInline">
              <button
                v-for="s in STARTER_THEMES"
                :key="s.id"
                :class="['obStarterCardInline', { selected: starterPickerSelection === s.id }]"
                @click="starterPickerSelection = s.id"
              >
                <span
                  class="obStarterDotInline"
                  :style="{ background: 'linear-gradient(135deg, ' + THEME_PREVIEWS[s.id]?.[resolvedMode]?.accent + ', ' + THEME_PREVIEWS[s.id]?.[resolvedMode]?.bg + ')' }"
                >
                  <svg v-if="s.id === 'fire'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 23c-4.97 0-8-3.03-8-7 0-2.5 1.5-5 3-6.5.5-.5 1.37-.18 1.37.54 0 1.3.6 2.46 1.63 3.2.2.14.46-.05.38-.28-.5-1.46-.63-3.1-.08-4.96C11.5 4.5 14 2 16 1c.4-.2.82.18.68.6C15.5 5.5 17 7 18 8.5c2 3 2 5 2 6.5 0 3.97-3.03 8-8 8z"/></svg>
                  <svg v-else-if="s.id === 'water'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M2 15c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 19c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3M2 11c0 0 2-3 4-3s4 3 6 3 4-3 6-3 4 3 4 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  <svg v-else-if="s.id === 'luck'" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12 3C12 3 9 6 9 8.5c0 1.4.7 2.6 1.8 3.2L12 12l1.2-.3C14.3 11.1 15 9.9 15 8.5 15 6 12 3 12 3z"/><path d="M21 12c0 0-3-3-5.5-3-1.4 0-2.6.7-3.2 1.8L12 12l.3 1.2c.6 1.1 1.8 1.8 3.2 1.8C18 15 21 12 21 12z"/><path d="M12 21c0 0 3-3 3-5.5 0-1.4-.7-2.6-1.8-3.2L12 12l-1.2.3C9.7 12.9 9 14.1 9 15.5 9 18 12 21 12 21z"/><path d="M3 12c0 0 3 3 5.5 3 1.4 0 2.6-.7 3.2-1.8L12 12l-.3-1.2C11.1 9.7 9.9 9 8.5 9 6 9 3 12 3 12z"/></svg>
                </span>
                <span class="obStarterLabelInline">{{ s.label }}</span>
              </button>
            </div>
            <div class="starterWarning">This choice is semi-permanent. You can change it later, but your progression will reset.</div>
            <button class="unlockDismiss" :disabled="!starterPickerSelection" @click="confirmStarterPick">{{ starterPickerSelection ? 'Choose ' + STARTER_THEMES.find(s => s.id === starterPickerSelection)?.label : 'Choose' }}</button>
            <button class="resetConfirmCancel" @click="skipStarterPick">Skip</button>
          </template>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Disable progression disclosure -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="disableProgressionVisible" class="unlockOverlay" @click.self="disableProgressionVisible = false">
        <div class="unlockModal">
          <div class="unlockTitle" style="color: var(--text-primary)">Disable Progression?</div>
          <div class="progressionDisclosure">
            <div class="disclosureRow disclosureOk">Your workouts and exercises will still be tracked normally.</div>
            <div class="disclosureRow disclosureWarn">You will not earn XP for sets logged while progression is off.</div>
            <div class="disclosureRow disclosureOk">Your existing XP and unlocked themes are preserved — unlocked themes stay usable.</div>
            <div class="disclosureRow disclosureHint">To hide XP info without losing progress, use "Show XP &amp; streaks" instead.</div>
          </div>
          <button class="unlockDismiss resetConfirmDanger" @click="confirmDisableProgression">Disable Progression</button>
          <button class="resetConfirmCancel" @click="disableProgressionVisible = false">Cancel</button>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Reset progress confirmation -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="resetConfirmVisible" class="unlockOverlay" @click.self="resetConfirmVisible = false">
        <div class="unlockModal">
          <div class="unlockTitle" style="color: var(--text-primary)">Reset Progress?</div>
          <div class="resetConfirmText">This will reset your XP to 0, lock all themes, and let you pick a new starter. Your workout data is not affected.</div>
          <button class="unlockDismiss resetConfirmDanger" @click="executeResetProgress">Reset &amp; Re-pick Starter</button>
          <button class="resetConfirmCancel" @click="resetConfirmVisible = false">Cancel</button>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Theme stats bottom sheet -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="themeStatsVisible" class="unlockOverlay" @click.self="closeThemeStats">
        <div class="themeStatsSheet">
          <div class="themeStatsHeader">
            <span class="themeStatsTitle">{{ themeStatsLabel }}</span>
            <button class="themeStatsClose" @click="closeThemeStats" aria-label="Close">&times;</button>
          </div>
          <template v-if="themeStatsData && themeStatsData.totalSets > 0">
            <div class="themeStatsGrid">
              <div class="themeStatItem">
                <span class="themeStatValue">{{ themeStatsData.totalSets }}</span>
                <span class="themeStatLabel">Sets</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ themeStatsData.totalReps.toLocaleString() }}</span>
                <span class="themeStatLabel">Reps</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ Math.round(themeStatsData.totalVolume).toLocaleString() }}</span>
                <span class="themeStatLabel">Volume (lbs)</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ themeStatsData.totalXP.toLocaleString() }}</span>
                <span class="themeStatLabel">XP Earned</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ themeStatsData.prCount }}</span>
                <span class="themeStatLabel">PRs</span>
              </div>
              <div class="themeStatItem">
                <span class="themeStatValue">{{ themeStatsData.daysUsed }}</span>
                <span class="themeStatLabel">Days</span>
              </div>
            </div>
            <div v-if="themeStatsData.favoriteExercise" class="themeStatRow">
              Favorite: <strong>{{ themeStatsData.favoriteExercise.name }}</strong> ({{ themeStatsData.favoriteExercise.sets }} sets)
            </div>
            <div class="themeStatRow">
              Avg XP per set: <strong>{{ themeStatsData.avgXPPerSet }}</strong>
            </div>
            <div v-if="themeStatsData.firstSetDate" class="themeStatRow themeStatMuted">
              {{ themeStatsData.firstSetDate.slice(0, 10) }} — {{ themeStatsData.lastSetDate?.slice(0, 10) }}
            </div>
          </template>
          <div v-else class="themeStatsEmpty">
            No training data with this theme yet. Log sets to build your stats.
          </div>
        </div>
      </div>
    </transition>
  </Teleport>

  <!-- Theme unlock celebration -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="unlockCelebration.visible" class="unlockOverlay" @click.self="dismissUnlockCelebration">
        <div class="unlockModal">
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
import { useTheme, connectProgressionStore, type ThemeId } from './composables/useTheme'
import { useProgressionStore, UNLOCK_TIERS, xpToast, unlockCelebration, dismissUnlockCelebration, showUnlockCelebration, showXPToast } from './stores/progression'
import { computeThemeStats, type ThemeStats } from './lib/themeStats'
import { isMigrated, markMigrated, clearMigrationFlag, computeRetroactiveXP } from './lib/xpMigration'
import { requestPersistentStorage, ensureLocalStorage } from './lib/durableStorage'
import { useAuth } from './composables/useAuth'
import { useAnalytics } from './composables/useAnalytics'
import { usePreferencesStore } from './stores/preferences'
import type { WeightGoalDirection } from './stores/preferences'
import { useWorkoutStore } from './stores/workout'
import { useBodyweightStore } from './stores/bodyweight'
import { useUndoToast } from './composables/useUndoToast'
import { useSwipeToDismiss } from './composables/useSwipeToDismiss'
import { useFocusTrap } from './composables/useFocusTrap'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { registerSW } from 'virtual:pwa-register'

const { currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode, glassEnabled, restTimerEnabled, restTimerAutoStart, weightUnit, displayWeight, toLbs, selectTheme: themeSelectFn, previewTheme, revertPreview, isThemeUnlocked } = useTheme()
const progressionStore = useProgressionStore()
connectProgressionStore(() => progressionStore)

const progressionActive = computed(() => progressionStore.progressionEnabled)

const effectiveWeeklyTarget = computed(() =>
  progressionStore.pendingTargetChange ?? progressionStore.weeklyTarget
)

function adjustWeeklyTarget(delta: number) {
  const next = Math.max(1, Math.min(7, effectiveWeeklyTarget.value + delta))
  progressionStore.setWeeklyTarget(next)
}

const weeklyGoalBonusLabel = computed(() => {
  const target = effectiveWeeklyTarget.value
  if (target >= 6) return 'Streak bonus: 1.5× (max)'
  if (target >= 5) return 'Streak bonus: 1.3×'
  if (target >= 4) return 'Streak bonus: 1.2×'
  if (target >= 3) return 'Streak bonus: 1.1×'
  return 'No streak bonus'
})

// Sort themes: unlocked first, then locked — both groups follow unlock-tier order.
// Themes not in UNLOCK_TIERS (unchosen starters) slot in before Eternal.
const sortedThemes = computed(() => {
  // Build a full display order from UNLOCK_TIERS, expanding null slots
  const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']
  const displayOrder: ThemeId[] = []
  for (const tier of UNLOCK_TIERS) {
    if (tier.themeId) {
      displayOrder.push(tier.themeId)
    } else if (tier.level === 1) {
      // Starter pick slot — insert the chosen starter, or all three if none chosen
      const chosen = progressionStore.starterTheme
      if (chosen) {
        displayOrder.push(chosen)
      } else {
        displayOrder.push(...STARTER_IDS)
      }
    }
  }
  // Append any remaining starter themes not yet in the list (unchosen ones) before Eternal
  for (const sid of STARTER_IDS) {
    if (!displayOrder.includes(sid)) {
      const eternalIdx = displayOrder.indexOf('eternal')
      if (eternalIdx !== -1) {
        displayOrder.splice(eternalIdx, 0, sid)
      } else {
        displayOrder.push(sid)
      }
    }
  }

  const inTrialPeriod = progressionActive.value && !progressionStore.starterConfirmed

  const orderIndex = (id: ThemeId) => {
    // During trial, keep all starters grouped right after Pearl
    if (inTrialPeriod && STARTER_IDS.includes(id)) return 1
    const idx = displayOrder.indexOf(id)
    return idx === -1 ? 999 : idx
  }

  const unlocked = THEMES.filter(t => isThemeUnlocked(t.id))
  const locked = THEMES.filter(t => !isThemeUnlocked(t.id))
  unlocked.sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  locked.sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  return [...unlocked, ...locked]
})

const { user, loading, signOut } = useAuth()
const { logEvent, tabSwitch, flushEngagement } = useAnalytics()
const prefs = usePreferencesStore()
const { toast: undoToast, performUndo } = useUndoToast()

const settingsOpen = ref(false)
const settingsEl = ref<HTMLElement | null>(null)
const settingsHandleEl = ref<HTMLElement | null>(null)
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
  if (el && el instanceof HTMLElement && el !== settingsEl.value) {
    settingsEl.value = el
    // Bind swipe-to-dismiss only on the drag handle, not the whole sheet,
    // so it doesn't interfere with scrolling the settings body
    nextTick(() => {
      const handle = settingsHandleEl.value
      if (handle) settingsSwipe.attach(el, handle)
    })
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
// Reactive so it catches data that loads asynchronously after auth.
// onboardingInProgress prevents the watcher from firing when the onboarding
// screen itself adds exercises (e.g. Popular Exercises option).
const onboardingInProgress = ref(!onboardingComplete.value)
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
  hasSampleData.value = false
}

function closeSettings() {
  if (!settingsOpen.value) return
  // Revert any active theme preview
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  if (previewingThemeId.value) {
    previewingThemeId.value = null
    revertPreview()
  }
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
const WEIGHT_GOALS: { id: WeightGoalDirection; label: string }[] = [
  { id: 'lose', label: 'Losing' },
  { id: 'maintain', label: 'Maintaining' },
  { id: 'gain', label: 'Gaining' },
]

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
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  previewingThemeId.value = null
  revertPreview()
  if (themeSelectFn(id as import('./composables/useTheme').ThemeId)) {
    logEvent('theme_change', { theme: id })
  }
}

// ── Dev tools (localhost/LAN only) ────────────────────────────────
const isDev = /^(localhost|127\.|192\.168\.|10\.)/.test(window.location.hostname)

function devResetOnboarding() {
  localStorage.removeItem('onboarding-complete')
  localStorage.removeItem('user-progression')
  location.reload()
}

const resetConfirmVisible = ref(false)

function confirmResetProgress() {
  resetConfirmVisible.value = true
}

const starterPickerVisible = ref(false)
const starterPickerStep = ref<'explainer' | 'pick'>('explainer')
const starterPickerSelection = ref<ThemeId | null>(null)

const STARTER_THEMES: { id: ThemeId; label: string }[] = [
  { id: 'fire', label: 'Intensity' },
  { id: 'water', label: 'Flow' },
  { id: 'luck', label: 'Luck' },
]

const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']
const progressionToggleEl = ref<HTMLElement | null>(null)

function scrollToProgressionToggle() {
  const el = progressionToggleEl.value
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('settingsRowHighlight')
  setTimeout(() => el.classList.remove('settingsRowHighlight'), 2000)
}

function isStarterTheme(id: ThemeId): boolean {
  return STARTER_IDS.includes(id)
}

function isEternalLocked(id: ThemeId): boolean {
  return id === 'eternal' && !isThemeUnlocked('eternal')
}

function showEternalHint() {
  const remaining = progressionStore.progressionEnabled
    ? Math.max(0, 1_000_000 - progressionStore.totalXP)
    : 1_000_000
  showXPToast(
    `${remaining.toLocaleString()} XP to discover this theme`,
    progressionStore.progressionEnabled ? progressionStore.progressPercent : 0,
    progressionStore.totalXP,
    1_000_000
  )
}

// ── Theme stats sheet ────────────────────────────────────────────
const themeStatsVisible = ref(false)
const themeStatsData = ref<ThemeStats | null>(null)
const themeStatsLabel = ref('')

function openThemeStats(id: ThemeId) {
  const stats = computeThemeStats(id, progressionStore.xpPerSet, workoutStoreForOnboarding.exercises)
  const theme = THEMES.find(t => t.id === id)
  themeStatsData.value = stats
  themeStatsLabel.value = theme?.label || id
  themeStatsVisible.value = true
}

function closeThemeStats() {
  themeStatsVisible.value = false
}

function executeResetProgress() {
  resetConfirmVisible.value = false
  progressionStore.epoch += 1
  progressionStore.totalXP = 0
  progressionStore.streakWeeks = 0
  progressionStore.streakHistory = []
  progressionStore.xpPerSet = {}
  progressionStore.bodyweightXPDates = []
  progressionStore.unlockedThemes = [{ id: 'pearl', unlockedAt: new Date().toISOString() }]
  progressionStore.starterTheme = null
  progressionStore.starterConfirmed = false
  progressionStore.progressionEnabled = false
  progressionStore._persist()
  // Note: do NOT clear migration flag — reset means fresh start, not re-migrate historical data
  markMigrated()
  // Show starter picker
  starterPickerSelection.value = null
  starterPickerStep.value = 'explainer'
  starterPickerVisible.value = true
}

function confirmStarterPick() {
  if (!starterPickerSelection.value) return
  starterPickerVisible.value = false
  progressionStore.setStarterTheme(starterPickerSelection.value)
  currentTheme.value = starterPickerSelection.value
  runMigrationIfNeeded()
  enforceThemeLock()
  catchUpStreaks()
}

function skipStarterPick() {
  starterPickerVisible.value = false
  // Enable with pearl as default
  progressionStore.progressionEnabled = true
  if (!progressionStore.starterTheme) {
    progressionStore.starterTheme = 'pearl'
  }
  progressionStore._persist()
  runMigrationIfNeeded()
  catchUpStreaks()
}

/** Evaluate missed weeks and show milestone toasts. */
function catchUpStreaks() {
  const streakBefore = progressionStore.streakWeeks
  progressionStore.evaluatePendingWeeks(workoutStoreForOnboarding.workoutDates)
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

/** If current theme is locked, switch to starter or pearl. */
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
      // Show celebration for each unlocked theme sequentially
      if (newUnlocks.length > 0) {
        newUnlocks.forEach((themeId, i) => {
          const theme = THEMES.find(t => t.id === themeId)
          if (theme) {
            setTimeout(() => showUnlockCelebration(theme.id, theme.label), 500 + i * 2500)
          }
        })
      }
    }
    markMigrated()
  }
}

const disableProgressionVisible = ref(false)

function confirmDisableProgression() {
  disableProgressionVisible.value = false
  progressionStore.progressionEnabled = false
  progressionStore._persist()
  enforceThemeLock()
}

function toggleProgression() {
  if (progressionActive.value) {
    // Show disclosure before disabling
    disableProgressionVisible.value = true
    return
  } else {
    const realStarters: ThemeId[] = ['fire', 'water', 'luck']
    const hasRealStarter = progressionStore.starterTheme && realStarters.includes(progressionStore.starterTheme)
    if (hasRealStarter) {
      // Re-enable with existing real starter
      progressionStore.progressionEnabled = true
      const starter = progressionStore.starterTheme!
      if (!progressionStore.unlockedThemes.some(t => t.id === starter)) {
        progressionStore.unlockedThemes.push({ id: starter, unlockedAt: new Date().toISOString() })
      }
      progressionStore._persist()
      enforceThemeLock()
      runMigrationIfNeeded()
      catchUpStreaks()
    } else {
      // No real starter chosen — clear pearl default, show explainer + picker
      progressionStore.starterTheme = null
      starterPickerSelection.value = null
      starterPickerStep.value = 'explainer'
      starterPickerVisible.value = true
    }
  }
}

function devSeedProgression(xp: number) {
  const starter = progressionStore.starterTheme || 'fire' as ThemeId
  progressionStore.totalXP = xp
  progressionStore.streakWeeks = 8
  progressionStore.weeklyTarget = 4
  progressionStore.showProgression = true
  progressionStore.progressionEnabled = true
  if (!progressionStore.starterTheme) {
    progressionStore.starterTheme = starter
  }
  progressionStore.streakHistory = [{ weekStart: '2026-03-30', streakCount: 8, weeklyTarget: 4, combinedMultiplier: 1.8 }]
  // Reset unlocks to just pearl + starter, then let checkUnlocks compute the rest
  progressionStore.unlockedThemes = [{ id: 'pearl', unlockedAt: new Date().toISOString() }]
  if (!progressionStore.unlockedThemes.some(t => t.id === starter)) {
    progressionStore.unlockedThemes.push({ id: starter, unlockedAt: new Date().toISOString() })
  }
  progressionStore.checkUnlocks()
  progressionStore._persist()
}

function devAddXP(amount: number) {
  progressionStore.totalXP += amount
  progressionStore.checkUnlocks()
  progressionStore._persist()
}

function devRunMigration() {
  clearMigrationFlag()
  const result = computeRetroactiveXP(workoutStoreForOnboarding.exercises, bodyweightStoreForOnboarding.entries)
  progressionStore.totalXP = result.totalXP
  progressionStore.xpPerSet = result.xpPerSet
  progressionStore.bodyweightXPDates = result.bodyweightXPDates
  progressionStore.checkUnlocks()
  progressionStore._persist()
  markMigrated()
}

function devClearAll() {
  localStorage.clear()
  location.reload()
}

const previewingThemeId = ref<ThemeId | null>(null)

// Map every theme to its XP requirement, accounting for starter slots
const themeXPRequired = computed(() => {
  const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']
  const chosen = progressionStore.starterTheme
  const unchosen = STARTER_IDS.filter(id => id !== chosen)
  const map: Partial<Record<ThemeId, number>> = {}

  for (const tier of UNLOCK_TIERS) {
    if (tier.themeId) {
      map[tier.themeId] = tier.xpRequired
    } else if (tier.level === 1 && chosen) {
      map[chosen] = tier.xpRequired
    } else if (tier.level === 7) {
      // Remaining unchosen starters share this tier
      for (const id of unchosen) {
        map[id] = tier.xpRequired
      }
    }
  }
  return map
})

const xpToUnlockPreview = computed(() => {
  if (!previewingThemeId.value) return 0
  const required = themeXPRequired.value[previewingThemeId.value] ?? 0
  return Math.max(0, required - progressionStore.totalXP)
})

let previewTimer: ReturnType<typeof setTimeout> | null = null

function handleThemePreview(id: ThemeId) {
  if (previewTimer) clearTimeout(previewTimer)
  document.documentElement.classList.remove('theme-fading')
  previewingThemeId.value = id
  previewTheme(id)
  previewTimer = setTimeout(() => {
    // Add fading class for smooth transition back
    document.documentElement.classList.add('theme-fading')
    previewingThemeId.value = null
    revertPreview()
    // Remove fading class after transition completes
    setTimeout(() => document.documentElement.classList.remove('theme-fading'), 900)
  }, 3000)
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
      progression: {
        totalXP: progressionStore.totalXP,
        epoch: progressionStore.epoch,
        streakWeeks: progressionStore.streakWeeks,
        weeklyTarget: progressionStore.weeklyTarget,
        starterTheme: progressionStore.starterTheme,
        unlockedThemes: progressionStore.unlockedThemes,
        xpPerSet: progressionStore.xpPerSet,
      },
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

// ── Weight Goal helpers ─────────────────────────────────────────
const bwStore = useBodyweightStore()
const showGoalInput = ref(false)

function setGoalDirection(dir: WeightGoalDirection) {
  prefs.setWeightGoalDirection(dir)
}

function onTargetWeightInput(val: string) {
  if (prefs.weightGoal.direction === 'maintain') return
  if (!val || val.trim() === '') return
  const num = parseFloat(val)
  if (isNaN(num) || num <= 0) return
  const lbs = toLbs(num)
  prefs.setTargetForDirection(lbs)
  // Auto-switch direction based on target vs current
  const current = bwStore.latestWeight
  if (current != null) {
    if (lbs < current && prefs.weightGoal.direction === 'gain') {
      prefs.setWeightGoalDirection('lose')
      // Move the value to the correct direction
      prefs.weightGoal.loseTarget = lbs
      prefs.weightGoal.gainTarget = null
    } else if (lbs > current && prefs.weightGoal.direction === 'lose') {
      prefs.setWeightGoalDirection('gain')
      prefs.weightGoal.gainTarget = lbs
      prefs.weightGoal.loseTarget = null
    }
  }
}

function onMaintainMinInput(val: string) {
  if (prefs.weightGoal.direction !== 'maintain') return
  const num = val.trim() === '' ? null : parseFloat(val)
  const lbs = num != null && !isNaN(num) && num > 0 ? toLbs(num) : null
  prefs.setMaintainRange(lbs, prefs.weightGoal.maintainMax)
}

function onMaintainMaxInput(val: string) {
  if (prefs.weightGoal.direction !== 'maintain') return
  const num = val.trim() === '' ? null : parseFloat(val)
  const lbs = num != null && !isNaN(num) && num > 0 ? toLbs(num) : null
  prefs.setMaintainRange(prefs.weightGoal.maintainMin, lbs)
}

function clearGoalValues() {
  prefs.clearAllGoalValues()
  showGoalInput.value = false
}

// Flush engagement timing on page unload
function onBeforeUnload() {
  flushEngagement()
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  logEvent('session_start')

  // Request persistent storage to prevent browser eviction
  requestPersistentStorage()

  // Restore from IndexedDB if localStorage was cleared
  const restored = await Promise.all([
    ensureLocalStorage('workout-exercises'),
    ensureLocalStorage('bodyweight-entries'),
    ensureLocalStorage('user-progression'),
  ])
  if (restored.some(r => r)) {
    // Data was restored from backup — reload stores
    location.reload()
    return
  }

  runMigrationIfNeeded()
  enforceThemeLock()

  if (progressionStore.progressionEnabled) {
    catchUpStreaks()
  }
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>
