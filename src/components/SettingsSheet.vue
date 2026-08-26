<template>
  <Teleport to="body">
    <div v-if="modelValue" class="settingsOverlay" @click.self="closeSettings" @keydown.escape="closeSettings">
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
          <div
            v-if="progressionActive && progressionStore.showProgression && progressionStore.nextUnlockThreshold !== null"
            class="badgeProgressBar"
            role="progressbar"
            aria-label="Progress to next theme unlock"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="progressionStore.progressPercent"
            :aria-valuetext="`${progressionStore.xpToNextUnlock.toLocaleString()} XP to next theme`"
          >
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
            <span class="settingsLabel">Units</span>
            <div class="modeSegmented">
              <button :class="['modeSegBtn', { active: weightUnit === 'lbs' }]" @click="weightUnit = 'lbs'" aria-label="Use pounds" :aria-pressed="weightUnit === 'lbs'">lbs</button>
              <button :class="['modeSegBtn', { active: weightUnit === 'kg' }]" @click="weightUnit = 'kg'" aria-label="Use kilograms" :aria-pressed="weightUnit === 'kg'">kg</button>
            </div>
          </div>
          <!-- App icon picker (native iOS only — alternate icons can't be set on web) -->
          <template v-if="showAppIconPicker">
            <div class="appIconHeader">
              <span class="settingsLabel">App Icon</span>
              <span class="settingsHint">Unlocks with matching themes</span>
            </div>
            <div class="settingsThemeGrid">
              <button
                v-for="icon in appIconOptions"
                :key="icon.id"
                :class="['themePreview', { active: icon.active, locked: !icon.unlocked }]"
                @click="icon.unlocked ? selectAppIcon(icon.id) : undefined"
                :aria-label="icon.unlocked ? 'Use ' + icon.label + ' app icon' : icon.label + ' app icon — locked'"
                :aria-pressed="icon.active"
              >
                <span
                  class="themePreviewDot"
                  :style="{ background: 'linear-gradient(135deg, ' + THEME_PREVIEWS[icon.previewTheme]?.[resolvedMode]?.accent + ', ' + THEME_PREVIEWS[icon.previewTheme]?.[resolvedMode]?.bg + ')' }"
                >
                  <svg v-if="!icon.unlocked" class="themePreviewLock" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  <svg v-else-if="icon.active" class="themePreviewCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span class="themePreviewLabel">{{ icon.label }}</span>
              </button>
            </div>
          </template>
        </div>

        <div class="settingsGroup">
          <div class="settingsHeader">Experience</div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Haptics</span>
              <span class="settingsHint">Taps, PRs, timer end</span>
            </div>
            <button
              :class="['glassToggle', { on: prefs.experience.haptics }]"
              @click="toggleExperience('haptics')"
              role="switch"
              :aria-checked="prefs.experience.haptics"
              :aria-label="prefs.experience.haptics ? 'Disable haptics' : 'Enable haptics'"
            >
              <span class="glassToggleThumb"></span>
            </button>
          </div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Celebrations</span>
              <span class="settingsHint">PR bursts & weekly goal hits</span>
            </div>
            <button
              :class="['glassToggle', { on: prefs.experience.prCelebrations }]"
              @click="toggleExperience('prCelebrations')"
              role="switch"
              :aria-checked="prefs.experience.prCelebrations"
              :aria-label="prefs.experience.prCelebrations ? 'Disable PR celebrations' : 'Enable PR celebrations'"
            >
              <span class="glassToggleThumb"></span>
            </button>
          </div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Keep screen on</span>
              <span class="settingsHint">During rest timer and logging</span>
            </div>
            <button
              :class="['glassToggle', { on: prefs.experience.screenWakeLock }]"
              @click="toggleExperience('screenWakeLock')"
              role="switch"
              :aria-checked="prefs.experience.screenWakeLock"
              :aria-label="prefs.experience.screenWakeLock ? 'Disable screen wake lock' : 'Enable screen wake lock'"
            >
              <span class="glassToggleThumb"></span>
            </button>
          </div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Rest Timer</span>
              <span v-if="restTimerEnabled && restTimerAutoStart" class="settingsHint">Auto-start after save</span>
            </div>
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
          <div v-show="restTimerEnabled" class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel settingsLabelIndented">Notify when done</span>
              <span class="settingsHint">When app is in background</span>
            </div>
            <button
              :class="['glassToggle', { on: prefs.experience.restTimerNotification }]"
              @click="toggleExperience('restTimerNotification')"
              role="switch"
              :aria-checked="prefs.experience.restTimerNotification"
              :aria-label="prefs.experience.restTimerNotification ? 'Disable rest timer notification' : 'Enable rest timer notification'"
            >
              <span class="glassToggleThumb"></span>
            </button>
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

        <div class="settingsGroup">
          <div class="settingsHeader">Personal Records</div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Evaluate PRs since</span>
              <span class="settingsHint">{{ formatBaselineLabel(prBaselineDate) }}</span>
            </div>
            <div class="settingsInputWrap">
              <input
                type="date"
                class="settingsInput"
                :value="prBaselineDate ?? ''"
                :max="new Date().toISOString().slice(0,10)"
                @change="onBaselineDateInput(($event.target as HTMLInputElement).value)"
                aria-label="PR baseline date"
              />
              <button
                v-if="prBaselineDate"
                class="settingsInputClear"
                @click="clearPRBaseline()"
                aria-label="Clear PR baseline (use all time)"
              >×</button>
            </div>
          </div>
          <div class="settingsRow">
            <button class="settingsRevealBtn" @click="confirmStartNewTrainingBlock">
              Start new training block
            </button>
          </div>
          <div class="settingsRow">
            <span class="settingsHint">
              PRs are evaluated against sets on or after this date. Your XP history and past workouts are never modified.
            </span>
          </div>
        </div>

        <div class="settingsGroup">
          <div class="settingsHeader">Filters</div>
          <div class="settingsRow">
            <div class="settingsLabelGroup">
              <span class="settingsLabel">Warmup threshold</span>
              <span class="settingsHint">Sets below {{ Math.round(prefs.filters.warmupThreshold * 100) }}% of top e1RM are warmups</span>
            </div>
          </div>
          <div class="settingsRow">
            <input
              type="range"
              class="settingsRange"
              min="50"
              max="95"
              step="5"
              :value="Math.round(prefs.filters.warmupThreshold * 100)"
              @input="prefs.setWarmupThreshold(Number(($event.target as HTMLInputElement).value) / 100)"
              :aria-label="`Warmup threshold: ${Math.round(prefs.filters.warmupThreshold * 100)}%`"
              aria-valuemin="50"
              aria-valuemax="95"
              :aria-valuenow="Math.round(prefs.filters.warmupThreshold * 100)"
            />
            <span class="settingsRangeValue">{{ Math.round(prefs.filters.warmupThreshold * 100) }}%</span>
          </div>
          <div class="settingsRow">
            <span class="settingsHint">
              Use the "Hide warmups" toggle in the timeline or exercise detail to filter classified warmup sets from view.
            </span>
          </div>
        </div>

        <!-- Intensity presets (#776): tappable % chips in the log-set Intensity lens -->
        <div class="settingsGroup">
          <div class="settingsHeader">Intensity Presets</div>
          <div
            v-for="p in prefs.intensityPresets"
            :key="p"
            class="settingsRow settingsPresetRow"
          >
            <div class="iosStepper">
              <button
                class="iosStepperBtn"
                @click="adjustPreset(p, -1)"
                :disabled="nextPresetValue(prefs.intensityPresets, p, -1) === null"
                :aria-label="`Lower ${p}% preset`"
              >−</button>
              <span class="iosStepperValue">{{ p }}%</span>
              <button
                class="iosStepperBtn"
                @click="adjustPreset(p, 1)"
                :disabled="nextPresetValue(prefs.intensityPresets, p, 1) === null"
                :aria-label="`Raise ${p}% preset`"
              >+</button>
            </div>
            <button
              class="settingsPresetDelete"
              @click="deletePreset(p)"
              :aria-label="`Delete ${p}% preset`"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
          <p v-if="!prefs.intensityPresets.length" class="settingsHint settingsPresetEmpty">
            No presets — the Intensity lens shows just the slider. Add one below.
          </p>
          <button
            class="settingsPresetAdd"
            @click="addPreset"
            :disabled="prefs.intensityPresets.length >= MAX_INTENSITY_PRESETS"
          >+ Add preset</button>
          <div class="settingsRow">
            <span class="settingsHint">
              Tap these in the log-set Intensity lens to jump straight to a training intensity. The slider stays for one-off values.
            </span>
          </div>
        </div>

        <!-- Gyms (#961): the zero-state entry point for per-gym exercise filtering -->
        <div class="settingsGroup">
          <div class="settingsHeader">Gyms</div>
          <button class="settingsRow settingsRowBtn" @click="gymManagerOpen = true">
            <span class="settingsLabel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>
              Manage Gyms
            </span>
            <span v-if="prefs.gyms.length" class="settingsHint">{{ prefs.gyms.length }}</span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="settingsRow">
            <span class="settingsHint">
              Assign exercises to the gyms you train at, then filter the exercise list by gym. Exercises with no gym show everywhere.
            </span>
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
          <div class="settingsRow">
            <span class="settingsLabel">Import</span>
            <div class="exportBtnGroup">
              <button class="exportBtn" @click="triggerImport" aria-label="Import workout data from CSV">CSV</button>
            </div>
            <input ref="importFileInput" type="file" accept=".csv" class="hiddenFileInput" aria-label="Import CSV file" @change="handleImportFile" />
          </div>
          <div class="settingsRow">
            <span class="settingsLabel">Report</span>
            <div class="exportBtnGroup">
              <button v-for="p in (['month', 'quarter', 'year'] as const)" :key="p" class="exportBtn" :class="{ exportBtnActive: reportPeriod === p }" :aria-label="`${p} training report`" :aria-pressed="reportPeriod === p" @click="reportPeriod = p">{{ p === 'quarter' ? 'Quarter' : p === 'year' ? 'Year' : 'Month' }}</button>
              <button class="exportBtn exportBtnPrimary" aria-label="Generate training report" @click="generateReport">Generate</button>
            </div>
          </div>
          <div v-if="importResult" class="settingsImportResult" role="status">
            <span v-if="importResult.error" class="settingsImportError">{{ importResult.error }}</span>
            <span v-else class="settingsImportSuccess">Imported {{ importResult.exercises }} exercise{{ importResult.exercises !== 1 ? 's' : '' }} with {{ importResult.sets }} sets ({{ importResult.format }})</span>
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


        <div ref="supportGroupEl" class="settingsGroup">
          <div class="settingsHeader">Support</div>
          <button class="settingsRow settingsRowBtn" :disabled="appShareInFlight" @click="shareLift">
            <span class="settingsLabel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              Share Lift
            </span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div v-if="appShareFeedback" class="settingsImportResult" role="status">
            <span class="settingsImportSuccess">{{ appShareFeedback }}</span>
          </div>
          <a class="settingsRow settingsRowBtn settingsLink" href="https://github.com/sponsors/aschung212" target="_blank" rel="noopener" @click="onSupportTap('github_sponsors')">
            <span class="settingsLabel">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              Sponsor on GitHub
            </span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
          <a class="settingsRow settingsRowBtn settingsLink" href="https://buymeacoffee.com/aschung212" target="_blank" rel="noopener" @click="onSupportTap('buymeacoffee')">
            <span class="settingsLabel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
              Buy Me a Coffee
            </span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
          <button
            v-if="isNative"
            class="settingsRow settingsRowBtn"
            :disabled="isRestoringPurchases"
            @click="restorePurchases"
          >
            <span class="settingsLabel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="vertical-align: -2px; margin-right: 6px; color: var(--accent)"><path d="M3 2v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8"/></svg>
              Restore Purchases
            </span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div v-if="restoreFeedback" class="settingsImportResult" role="status">
            <span class="settingsImportSuccess">{{ restoreFeedback }}</span>
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

        <div class="settingsGroup">
          <div class="settingsHeader">Danger Zone</div>
          <button class="settingsRow settingsRowBtn settingsDeleteAccount" @click="showDeleteAccountConfirm">
            <span class="settingsLabel">Delete Account</span>
            <svg class="settingsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Legal modal (extracted to LegalSheet.vue) -->
  <LegalSheet :view="legalView" @close="legalView = null" />

  <!-- Gym Manager (#961) — same modal the workout tab's gym row opens -->
  <GymManagerModal
    :open="gymManagerOpen"
    :gyms="prefs.gyms"
    :exercises="liveExercises"
    @close="gymManagerOpen = false"
    @create-gym="gymActions.createGym"
    @rename-gym="gymActions.renameGym"
    @delete-gym="gymActions.deleteGym"
    @toggle-exercise-gym="gymActions.toggleExerciseGym"
  />

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

  <!-- Delete account confirmation dialog -->
  <Teleport to="body">
    <Transition name="undoToast">
      <div v-if="deleteAccountOpen" class="confirmOverlay" @click.self="deleteAccountOpen = false" @keydown.escape="deleteAccountOpen = false">
        <div class="confirmSheet deleteConfirmSheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc">
          <p id="delete-title" class="confirmMessage deleteConfirmTitle">Delete Account</p>
          <p id="delete-desc" class="deleteConfirmDesc">This will permanently erase all your workout data, progression, and settings. This action cannot be undone.</p>
          <label class="deleteConfirmLabel" for="delete-confirm-input">Type <strong>DELETE</strong> to confirm</label>
          <input
            id="delete-confirm-input"
            v-model="deleteConfirmText"
            class="deleteConfirmInput"
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="DELETE"
          />
          <p v-if="deleteError" class="deleteConfirmError" role="alert">{{ deleteError }}</p>
          <div class="confirmActions">
            <button class="confirmBtn confirmBtnCancel" @click="deleteAccountOpen = false">Cancel</button>
            <button
              class="confirmBtn deleteConfirmBtn"
              :disabled="deleteConfirmText !== 'DELETE' || deletingAccount"
              @click="executeDeleteAccount"
            >
              {{ deletingAccount ? 'Deleting…' : 'Delete Everything' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Progression explainer + starter picker modal -->
  <Teleport to="body">
    <transition name="unlockFade">
      <div v-if="starterPickerVisible" class="unlockOverlay">
        <div class="unlockModal">
          <StarterPickerFlow
            ref="starterPickerRef"
            :resolved-mode="resolvedMode"
            @confirm="handleStarterConfirm"
            @skip="handleStarterSkip"
            @preview="handleStarterPreview"
            @revert-preview="handleStarterRevertPreview"
          />
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
            <div class="disclosureRow disclosureOk">Your streak is based on training days — it continues as long as you keep hitting your weekly goal, even with progression off.</div>
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

  <!-- Theme stats bottom sheet (extracted to ThemeStatsSheet.vue) -->
  <ThemeStatsSheet
    :visible="themeStatsVisible"
    :label="themeStatsLabel"
    :stats="themeStatsData"
    @close="themeStatsVisible = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, type ComponentPublicInstance } from 'vue'
import { useTheme } from '../composables/useTheme'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useRestTimer } from '../composables/useRestTimer'
import type { ThemeId } from '../lib/themes'
import { usePRBaseline } from '../composables/usePRBaseline'
import { useProgressionStore, UNLOCK_TIERS } from '../stores/progression'
import { showXPToast } from '../composables/xpCeremonyUI'
import { isNative } from '../lib/platform'
import { APP_ICONS, getAppIcon, isAppIconUnlocked, resolveAppIconId, type AppIconId } from '../lib/appIcons'
import { setNativeAppIcon } from '../lib/nativeAppIcon'
import { computeThemeStats, type ThemeStats } from '../lib/themeStats'
import { useXPCeremony } from '../composables/useXPCeremony'
import { isMigrated, markMigrated, clearMigrationFlag, computeRetroactiveXP } from '../lib/xpMigration'
import { clearIDB } from '../lib/durableStorage'
import { useAuth } from '../composables/useAuth'
import { useAnalytics } from '../composables/useAnalytics'
import { hashUserId, buildJsonExport, buildCsvExport, downloadBlob } from '../lib/dataExport'
import { buildTrainingReport, type ReportPeriod } from '../lib/trainingReport'
import { renderReport, openReportWindow } from '../lib/reportRenderer'
import { importCSV } from '../lib/csvImport'
import { usePreferencesStore } from '../stores/preferences'
import type { WeightGoalDirection } from '../stores/preferences'
import { MAX_INTENSITY_PRESETS, nextPresetValue, pickNewPresetValue } from '../lib/intensityTable'
import { useWorkoutStore } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import { useFocusTrap } from '../composables/useFocusTrap'
import { useModal } from '../composables/useModal'
import { useAppShare } from '../composables/useAppShare'
import { useRestorePurchases } from '../composables/useRestorePurchases'
import LegalSheet from './LegalSheet.vue'
import ThemeStatsSheet from './ThemeStatsSheet.vue'
import GymManagerModal from './GymManagerModal.vue'
import { useGymActions } from '../composables/useGymActions'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'sign-out': []
}>()

const { currentTheme, THEMES, THEME_PREVIEWS, colorMode, resolvedMode, selectTheme: themeSelectFn, previewTheme, revertPreview, isThemeUnlocked } = useTheme()
const { restTimerEnabled, restTimerAutoStart } = useRestTimer()
const { weightUnit, displayWeight, toLbs } = useWeightUnit()
const { prBaselineDate, setPRBaseline, startNewTrainingBlock, clearPRBaseline } = usePRBaseline()
const progressionStore = useProgressionStore()
const { celebrateUnlocks } = useXPCeremony()
const { user } = useAuth()
const { logEvent, supportFunnel } = useAnalytics()
const prefs = usePreferencesStore()
const workoutStore = useWorkoutStore()

// ── Gym manager (#961) ──────────────────────────────────────────
const gymManagerOpen = ref(false)
const gymActions = useGymActions()
// Fresh-identity exercises for the manager checklist (#963): the workout
// store mutates in place behind a shallowRef, so binding the raw array would
// freeze the modal's checkmarks/counts while open (see WorkoutTracker's
// liveExercises for the full story).
const liveExercises = computed(() => [...workoutStore.exercises])
const bodyweightStore = useBodyweightStore()

const progressionActive = computed(() => progressionStore.progressionEnabled)

// ── Intensity presets editor (#776) ────────────────────────────
// Edits the global preset list shown as tappable chips in the log-set Intensity
// lens. Pure step/add logic lives in intensityTable.ts (unit-tested); these
// thin wrappers apply the result through the store (which dedupes/sorts/persists).
function adjustPreset(value: number, dir: 1 | -1) {
  const next = nextPresetValue(prefs.intensityPresets, value, dir)
  if (next === null) return
  prefs.setIntensityPresets(prefs.intensityPresets.map(p => (p === value ? next : p)))
}

function deletePreset(value: number) {
  prefs.setIntensityPresets(prefs.intensityPresets.filter(p => p !== value))
}

function addPreset() {
  const candidate = pickNewPresetValue(prefs.intensityPresets)
  if (candidate === null) return
  prefs.setIntensityPresets([...prefs.intensityPresets, candidate])
}

// ── Share the app (word-of-mouth loop, #713) ───────────────────
const { shareApp, isSharing: appShareInFlight } = useAppShare()
const appShareFeedback = ref<string | null>(null)
let appShareFeedbackTimer: ReturnType<typeof setTimeout> | null = null

// Restore Purchases (App Store Guideline 3.1.1, LIFT-1201) — native-only, since
// the web build sells nothing via IAP. The composable owns the funnel event and
// the auto-clearing status line.
const {
  isRestoring: isRestoringPurchases,
  feedback: restoreFeedback,
  restore: restorePurchases,
} = useRestorePurchases()

async function shareLift() {
  appShareFeedback.value = null
  const res = await shareApp()
  logEvent('app_share', { outcome: res.kind })
  // The native/Web Share sheet is its own confirmation; only the clipboard
  // fallback and error paths need an inline status line.
  if (res.kind === 'copied') appShareFeedback.value = 'Link copied to clipboard'
  else if (res.kind === 'unavailable') appShareFeedback.value = 'Sharing unavailable on this device'
  else if (res.kind === 'error') appShareFeedback.value = 'Could not share — try again'
  if (appShareFeedback.value) {
    if (appShareFeedbackTimer) clearTimeout(appShareFeedbackTimer)
    appShareFeedbackTimer = setTimeout(() => { appShareFeedback.value = null }, 3000)
  }
}

// ── Supporter conversion funnel (LIFT-906) ─────────────────────
// Instrument the Support-group CTAs so tip-jar vs. subscription can be a
// data-driven decision before any IAP is wired. Taps fire on each external
// CTA; the default navigation is left untouched.
function onSupportTap(cta: 'github_sponsors' | 'buymeacoffee') {
  supportFunnel('tap', { cta })
}

// The impression is the TOP of the funnel, so it must mean "the user actually
// saw the Support CTAs" — not merely "opened Settings". The Support group is
// the 12th of 14 groups, near the bottom of a long scroll, so firing on open
// counted a mostly-unseen CTA and made tap/impression conversion meaningless.
// Fire it once per settings-open, only when the group scrolls into view.
const supportGroupEl = ref<HTMLElement | null>(null)
let supportObserver: IntersectionObserver | null = null
let impressionLogged = false

function armSupportImpression() {
  if (impressionLogged) return
  const el = supportGroupEl.value
  if (!el) return
  // Platforms without IntersectionObserver (should not happen on iOS 12.2+ /
  // modern Chromium) fall back to the old open-time proxy so the funnel top is
  // never silently empty.
  if (typeof IntersectionObserver === 'undefined') {
    impressionLogged = true
    supportFunnel('impression')
    return
  }
  supportObserver = new IntersectionObserver((entries) => {
    if (impressionLogged) return
    if (entries.some((e) => e.isIntersecting)) {
      impressionLogged = true
      supportFunnel('impression')
      disarmSupportImpression()
    }
  })
  supportObserver.observe(el)
}

function disarmSupportImpression() {
  supportObserver?.disconnect()
  supportObserver = null
}

// ── App icon picker (native iOS only) ──────────────────────────
const showAppIconPicker = isNative
// Mirror the theme-grid unlock rules (incl. the trial period) so a starter's
// matching icon unlocks exactly when its theme does.
const unlockedThemeIds = computed<ThemeId[]>(() =>
  THEMES.filter(t => isThemeUnlocked(t.id)).map(t => t.id)
)
const appIconOptions = computed(() =>
  APP_ICONS.map(icon => ({
    id: icon.id,
    label: icon.label,
    previewTheme: icon.previewTheme,
    unlocked: isAppIconUnlocked(icon, unlockedThemeIds.value),
    active: prefs.appIcon === icon.id,
  }))
)

function selectAppIcon(id: AppIconId) {
  const icon = getAppIcon(id)
  if (!isAppIconUnlocked(icon, unlockedThemeIds.value)) return
  if (prefs.appIcon === id) return
  // Local-first: persist the choice; the reconcile watcher applies it to the OS.
  prefs.setAppIcon(id)
  logEvent('app_icon_change', { icon: id })
}

// Keep the native OS icon in sync with the stored preference. Runs on mount
// (immediate) so a preference synced from another device is applied, and on any
// change — including reverting to the default icon if its theme was re-locked by
// a progression/prestige reset (resolveAppIconId handles the fallback).
if (isNative) {
  watch(
    () => [prefs.appIcon, unlockedThemeIds.value.join(',')] as const,
    () => {
      const resolved = resolveAppIconId(prefs.appIcon, unlockedThemeIds.value)
      if (resolved !== prefs.appIcon) {
        prefs.setAppIcon(resolved) // reverts a now-locked icon; re-triggers this watcher
        return
      }
      void setNativeAppIcon(getAppIcon(resolved).nativeName)
    },
    { immediate: true }
  )
}

// ── Swipe-to-dismiss for settings sheet ────────────────────────
const settingsEl = ref<HTMLElement | null>(null)
const settingsHandleEl = ref<HTMLElement | null>(null)
const legalView = ref<'privacy' | 'terms' | null>(null)

const settingsSwipe = useSwipeToDismiss({
  threshold: 80,
  onDismiss: () => { emit('update:modelValue', false) },
})

// ── Modal lifecycle: useModal owns the lock + focus trap ───────
//
// The settings sheet is a full-screen bottom sheet, so the background must
// not stay scrollable underneath it — but this component never took the
// lock at all. It is taken here through useModal so it goes through the
// SAME reference count every other modal uses: a boolean `modal-open`
// toggle would strip the class out from under whichever other surface
// still had a modal open, and a scrollable background under a
// `position: fixed` modal desyncs paint from hit-testing the moment the
// iOS keyboard opens (taps land a row low, #830).
//
// The trap element comes from the `onSettingsSheetMounted` function ref
// below — the sheet already needs that ref for the swipe gesture and the
// close animation, so useModal reads it via `trapRef` rather than a
// selector. Escape stays on the overlay's `@keydown.escape` handler,
// which routes through closeSettings()'s animation/idempotency guards.
const settingsModal = useModal()
const confirmFocus = useFocusTrap()

// `immediate` is REQUIRED, not incidental: App.vue mounts this component with
// `v-if="settingsOpen"` (#955), so the sheet arrives already-open and the
// false→true transition never happens here. Without it the lock would never
// be acquired on the only path that actually opens the sheet.
watch(() => props.modelValue, (open) => {
  if (open) {
    settingsModal.open()
    // Top of the supporter funnel (LIFT-906): arm a visibility observer so the
    // impression fires only once the Support group actually scrolls into view,
    // not merely because Settings opened. nextTick so the ref is populated.
    nextTick(armSupportImpression)
  } else {
    settingsModal.close()
    settingsSwipe.detach()
    disarmSupportImpression()
    impressionLogged = false
  }
}, { immediate: true })

function onSettingsSheetMounted(el: Element | ComponentPublicInstance | null) {
  if (el && el instanceof HTMLElement && el !== settingsEl.value) {
    settingsEl.value = el
    settingsModal.trapRef.value = el
    nextTick(() => {
      const handle = settingsHandleEl.value
      if (handle) settingsSwipe.attach(el, handle)
    })
  }
}

/**
 * Duration of `sheetSlideDown` in index.css. The fallback below waits a little
 * longer than the animation so the event wins the race under normal conditions.
 */
const CLOSE_ANIM_MS = 150

let closing = false
let closeFallbackTimer: ReturnType<typeof setTimeout> | null = null

/** Commit the close exactly once, whatever settled it. */
function settleClose() {
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null }
  closing = false
  emit('update:modelValue', false)
}

/**
 * Close the sheet. The slide-down animation is decoration — it must never be
 * the thing that owns `modelValue`.
 *
 * This previously emitted the close from a bare one-shot `animationend`
 * listener, so the app's `settingsOpen` flag only cleared if that event
 * actually arrived. When it didn't — background the PWA mid-close and iOS
 * freezes animations on a hidden page, so `sheetSlideDown` never completes —
 * the emit never fired and `settingsOpen` stayed `true` forever with the sheet
 * parked off-screen by `animation-fill-mode: forwards`. Nothing could recover
 * it: the gear button reads `settingsOpen ? closeSettings() : (settingsOpen =
 * true)`, so it could only ever re-enter this function, and `classList.add` of
 * an already-present class does NOT restart a CSS animation — no further
 * `animationend` was ever coming. Settings then refused to open until a full
 * app reload, which is exactly how the bug was reported.
 *
 * Three guarantees now:
 *  1. `closing` makes the close idempotent — one animation, one settle.
 *  2. `animationend` bubbles, so the handler matches on this element and this
 *     animation; a descendant's animation ending can no longer close the sheet
 *     out from under the user.
 *  3. A fallback timer settles the close even if the event never lands. CSS
 *     still drives the motion — the timer only guarantees the state change,
 *     the same safety net Vue's own <Transition> keeps.
 */
function closeSettings() {
  if (!props.modelValue || closing) return
  // Revert any active theme preview
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  if (previewingThemeId.value) {
    previewingThemeId.value = null
    revertPreview()
  }
  const el = settingsEl.value
  if (!el) { settleClose(); return }
  closing = true
  el.classList.add('settingsSheetClosing')
  const onAnimationEnd = (e: AnimationEvent) => {
    if (e.target !== el || e.animationName !== 'sheetSlideDown') return
    el.removeEventListener('animationend', onAnimationEnd)
    settleClose()
  }
  el.addEventListener('animationend', onAnimationEnd)
  closeFallbackTimer = setTimeout(() => {
    el.removeEventListener('animationend', onAnimationEnd)
    settleClose()
  }, CLOSE_ANIM_MS + 100)
}

onUnmounted(() => {
  if (closeFallbackTimer) { clearTimeout(closeFallbackTimer); closeFallbackTimer = null }
  disarmSupportImpression()
})

defineExpose({ closeSettings })

// ── Confirm dialog ─────────────────────────────────────────────
const confirmDialog = ref<{ message: string; onConfirm: () => void } | null>(null)

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

watch(confirmDialog, async (dialog) => {
  if (dialog) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.confirmSheet')
    if (el) confirmFocus.activate(el)
  } else {
    confirmFocus.deactivate()
  }
})

// ── Delete account state ──────────────────────────────────────────
const deleteAccountOpen = ref(false)
const deleteConfirmText = ref('')
const deletingAccount = ref(false)
const deleteError = ref('')
const { deleteAccount } = useAuth()

function showDeleteAccountConfirm() {
  deleteConfirmText.value = ''
  deleteError.value = ''
  deletingAccount.value = false
  deleteAccountOpen.value = true
  logEvent('delete_account_opened')
}

async function executeDeleteAccount() {
  if (deleteConfirmText.value !== 'DELETE') return
  deletingAccount.value = true
  deleteError.value = ''
  try {
    await deleteAccount()
    deleteAccountOpen.value = false
    emit('update:modelValue', false)
    logEvent('account_deleted')
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Deletion failed. Please try again.'
    deletingAccount.value = false
  }
}

function confirmSignOut() {
  showConfirm('Sign out?', () => {
    emit('update:modelValue', false)
    emit('sign-out')
  })
}

// ── Theme selection & preview ──────────────────────────────────
function selectTheme(id: string) {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  previewingThemeId.value = null
  revertPreview()
  if (themeSelectFn(id as ThemeId)) {
    logEvent('theme_change', { theme: id })
  }
}

const previewingThemeId = ref<ThemeId | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null

function handleThemePreview(id: ThemeId) {
  if (previewTimer) clearTimeout(previewTimer)
  document.documentElement.classList.remove('theme-fading')
  previewingThemeId.value = id
  previewTheme(id)
  previewTimer = setTimeout(() => {
    document.documentElement.classList.add('theme-fading')
    previewingThemeId.value = null
    revertPreview()
    setTimeout(() => document.documentElement.classList.remove('theme-fading'), 900)
  }, 3000)
}

// ── Sorted themes ──────────────────────────────────────────────
const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']

const sortedThemes = computed(() => {
  const displayOrder: ThemeId[] = []
  for (const tier of UNLOCK_TIERS) {
    if (tier.themeId) {
      displayOrder.push(tier.themeId)
    } else if (tier.level === 1) {
      const chosen = progressionStore.starterTheme
      if (chosen) {
        displayOrder.push(chosen)
      } else {
        displayOrder.push(...STARTER_IDS)
      }
    }
  }
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

// ── Theme XP required ──────────────────────────────────────────
const themeXPRequired = computed(() => {
  const chosen = progressionStore.starterTheme
  const unchosen = STARTER_IDS.filter(id => id !== chosen)
  const map: Partial<Record<ThemeId, number>> = {}

  for (const tier of UNLOCK_TIERS) {
    if (tier.themeId) {
      map[tier.themeId] = tier.xpRequired
    } else if (tier.level === 1 && chosen) {
      map[chosen] = tier.xpRequired
    } else if (tier.level === 7) {
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
  const stats = computeThemeStats(id, progressionStore.xpPerSet, workoutStore.exercises)
  const theme = THEMES.find(t => t.id === id)
  themeStatsData.value = stats
  themeStatsLabel.value = theme?.label || id
  themeStatsVisible.value = true
}

// ── Progression toggle ─────────────────────────────────────────
const progressionToggleEl = ref<HTMLElement | null>(null)

function scrollToProgressionToggle() {
  const el = progressionToggleEl.value
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('settingsRowHighlight')
  setTimeout(() => el.classList.remove('settingsRowHighlight'), 2000)
}

const resetConfirmVisible = ref(false)

function confirmResetProgress() {
  resetConfirmVisible.value = true
}

function toggleProgression() {
  if (progressionActive.value) {
    disableProgressionVisible.value = true
    return
  } else {
    const realStarters: ThemeId[] = ['fire', 'water', 'luck']
    const hasRealStarter = progressionStore.starterTheme && realStarters.includes(progressionStore.starterTheme)
    if (hasRealStarter) {
      progressionStore.progressionEnabled = true
      const starter = progressionStore.starterTheme!
      if (!progressionStore.unlockedThemes.some(t => t.id === starter)) {
        progressionStore.unlockedThemes.push({ id: starter, unlockedAt: new Date().toISOString() })
      }
      progressionStore._persist()
      progressionStore._syncToSupabase()
      enforceThemeLock()
      runMigrationIfNeeded()
      catchUpStreaks()
    } else {
      progressionStore.starterTheme = null
      starterPickerRef.value?.reset()
      starterPickerVisible.value = true
    }
  }
}

const disableProgressionVisible = ref(false)

function confirmDisableProgression() {
  disableProgressionVisible.value = false
  progressionStore.progressionEnabled = false
  progressionStore._persist()
  progressionStore._syncToSupabase()
  enforceThemeLock()
}

function enforceThemeLock() {
  if (!isThemeUnlocked(currentTheme.value as ThemeId)) {
    currentTheme.value = 'pearl'
  }
}

function runMigrationIfNeeded() {
  if (progressionStore.progressionEnabled && !isMigrated()) {
    const result = computeRetroactiveXP(workoutStore.exercises, bodyweightStore.entries)
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

/** Build setId→date map from workout store for streak evaluation. */
function buildSetIdToDate(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const exercise of workoutStore.exercises) {
    for (const set of exercise.sets) {
      map[set.id] = set.date.slice(0, 10)
    }
  }
  return map
}

function catchUpStreaks() {
  const streakBefore = progressionStore.streakWeeks
  const setIdToDate = buildSetIdToDate()
  progressionStore.evaluatePendingWeeks(workoutStore.workoutDates, new Date(), setIdToDate)
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

// ── Starter picker (exposed for reset progress) ────────────────
import StarterPickerFlow from './StarterPickerFlow.vue'
const starterPickerVisible = ref(false)
const starterPickerRef = ref<InstanceType<typeof StarterPickerFlow> | null>(null)

watch(starterPickerVisible, (visible) => { if (!visible) revertPreview() })

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
  progressionStore._syncToSupabase()
  markMigrated()
  starterPickerRef.value?.reset()
  starterPickerVisible.value = true
}

function handleStarterPreview(themeId: ThemeId) {
  previewTheme(themeId)
}

function handleStarterRevertPreview() {
  revertPreview()
}

function handleStarterConfirm(themeId: ThemeId, weeklyGoal: number) {
  revertPreview()
  starterPickerVisible.value = false
  progressionStore.setStarterTheme(themeId, weeklyGoal)
  currentTheme.value = themeId
  runMigrationIfNeeded()
  enforceThemeLock()
  catchUpStreaks()
}

function handleStarterSkip() {
  revertPreview()
  starterPickerVisible.value = false
  progressionStore.progressionEnabled = true
  if (!progressionStore.starterTheme) {
    progressionStore.starterTheme = 'pearl'
  }
  progressionStore._persist()
  progressionStore._syncToSupabase()
  runMigrationIfNeeded()
  catchUpStreaks()
}

// ── Weekly target ──────────────────────────────────────────────
const effectiveWeeklyTarget = computed(() =>
  progressionStore.pendingTargetChange ?? progressionStore.weeklyTarget
)

function adjustWeeklyTarget(delta: number) {
  const next = Math.max(1, Math.min(7, effectiveWeeklyTarget.value + delta))
  progressionStore.setWeeklyTarget(next)
}

const weeklyGoalBonusLabel = computed(() => {
  const target = effectiveWeeklyTarget.value
  if (target >= 6) return 'Initial streak bonus: 1.5× (max)'
  if (target >= 5) return 'Initial streak bonus: 1.3×'
  if (target >= 4) return 'Initial streak bonus: 1.2×'
  if (target >= 3) return 'Initial streak bonus: 1.1×'
  return 'No streak bonus'
})

// ── PR baseline ────────────────────────────────────────────────
function formatBaselineLabel(iso: string | null): string {
  if (!iso) return 'All time'
  const d = new Date(iso + 'T12:00:00')
  if (isNaN(d.getTime())) return 'All time'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function onBaselineDateInput(value: string) {
  if (!value) clearPRBaseline()
  else setPRBaseline(value)
}

function confirmStartNewTrainingBlock() {
  const nextLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  showConfirm(
    `Start a new training block from ${nextLabel}? PRs will be evaluated only against sets from today onward. Your XP history stays intact.`,
    () => { startNewTrainingBlock() }
  )
}

// ── Mode & experience toggles ──────────────────────────────────
function setMode(mode: 'light' | 'dark' | 'auto') {
  colorMode.value = mode
  logEvent('mode_toggle', { mode })
}

function toggleExperience(key: 'prCelebrations' | 'haptics' | 'screenWakeLock' | 'restTimerNotification') {
  const next = !prefs.experience[key]
  prefs.setExperienceFlag(key, next)
  logEvent('experience_toggle', { key, enabled: next })
}

function toggleFeature(featureId: string) {
  prefs.toggleFeature(featureId)
  logEvent('feature_toggle', { feature: featureId, enabled: prefs.features[featureId] })
}

// ── Tab definitions (for feature toggles) ──────────────────────
const TAB_DEFS = [
  { id: 'workouts', label: 'Workouts' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'weight', label: 'Weight' },
]

// ── Weight Goal helpers ─────────────────────────────────────────
const WEIGHT_GOALS: { id: WeightGoalDirection; label: string }[] = [
  { id: 'lose', label: 'Losing' },
  { id: 'maintain', label: 'Maintaining' },
  { id: 'gain', label: 'Gaining' },
]

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
  const current = bodyweightStore.latestWeight
  if (current != null) {
    if (lbs < current && prefs.weightGoal.direction === 'gain') {
      prefs.setWeightGoalDirection('lose')
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

// ── Data export/import ─────────────────────────────────────────
async function exportData(format: 'csv' | 'json') {
  const timestamp = new Date().toISOString().slice(0, 10)
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'
  const userIdHash = user.value?.id ? await hashUserId(user.value.id) : 'anonymous'
  const metadata = { exportDate: new Date().toISOString(), appVersion, userIdHash }

  if (format === 'json') {
    const data = buildJsonExport(metadata, workoutStore.exercises, bodyweightStore.sortedEntries, {
      totalXP: progressionStore.totalXP,
      epoch: progressionStore.epoch,
      streakWeeks: progressionStore.streakWeeks,
      weeklyTarget: progressionStore.weeklyTarget,
      starterTheme: progressionStore.starterTheme,
      unlockedThemes: progressionStore.unlockedThemes,
      xpPerSet: progressionStore.xpPerSet,
    })
    downloadFile(`lift-export-${timestamp}.json`, JSON.stringify(data, null, 2), 'application/json')
  } else {
    const csv = buildCsvExport(metadata, workoutStore.exercises, bodyweightStore.sortedEntries)
    downloadFile(`lift-export-${timestamp}.csv`, csv, 'text/csv')
  }
  logEvent('data_export', { format })
}

function downloadFile(filename: string, content: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}

// ── Training Report ─────────────────────────────────────────────
const reportPeriod = ref<ReportPeriod>('month')

function generateReport() {
  const report = buildTrainingReport({
    exercises: workoutStore.exercises,
    bodyweight: bodyweightStore.sortedEntries,
    period: reportPeriod.value,
    toDisplayUnits: displayWeight,
    unitLabel: weightUnit.value === 'kg' ? 'kg' : 'lbs',
  })
  const html = renderReport(report)
  openReportWindow(html)
  logEvent('training_report', { period: reportPeriod.value })
}

// ── CSV Import ──────────────────────────────────────────────────
const importFileInput = ref<HTMLInputElement | null>(null)
const importResult = ref<{ exercises: number; sets: number; format: string; error?: string } | null>(null)

function triggerImport() {
  importResult.value = null
  importFileInput.value?.click()
}

function handleImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    const result = importCSV(text)
    if (result.format === 'unknown' || result.exercises.length === 0) {
      importResult.value = { exercises: 0, sets: 0, format: 'unknown', error: 'Unrecognized format. Supported: Strong, Hevy, Lift CSV.' }
      return
    }
    for (const ex of result.exercises) {
      const existingId = workoutStore.addExercise(ex.name, ex.tags, { sync: false })
      if (!existingId) continue
      for (const set of ex.sets) {
        workoutStore.logSet(existingId, set.weight, set.reps, set.date.slice(0, 10), { sync: false })
      }
    }
    importResult.value = { exercises: result.exercises.length, sets: result.totalSets, format: result.format }
    logEvent('data_import', { format: result.format, exercises: result.exercises.length, sets: result.totalSets })
  }
  reader.readAsText(file)
  if (importFileInput.value) importFileInput.value.value = ''
}

// ── Dev tools (localhost/LAN only) ────────────────────────────────
const isDev = /^(localhost|127\.|192\.168\.|10\.)/.test(window.location.hostname)

function devResetOnboarding() {
  localStorage.removeItem('onboarding-complete')
  localStorage.removeItem('user-progression')
  location.reload()
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
  const result = computeRetroactiveXP(workoutStore.exercises, bodyweightStore.entries)
  progressionStore.totalXP = result.totalXP
  progressionStore.xpPerSet = result.xpPerSet
  progressionStore.bodyweightXPDates = result.bodyweightXPDates
  progressionStore.checkUnlocks()
  progressionStore._persist()
  markMigrated()
}

async function devClearAll() {
  localStorage.clear()
  await clearIDB()
  location.reload()
}
</script>
