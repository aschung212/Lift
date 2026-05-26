<template>
  <!-- Log / Edit Set Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay logSetOverlay" @click.self="onOverlayClick" @keydown.escape="closeModal">
      <div ref="logSheetEl" class="repMaxModal logSetSheet" :style="logSwipe.dragStyle()" @click.self="editingPresets = false" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
        <div ref="logSheetHandleEl" class="logSetSheetHandle" aria-hidden="true"></div>

        <!-- Rest timer view -->
        <template v-if="timerActive">
          <div v-if="timerUrgent && !timerPaused && !editingPresets" class="wtTimerFlash"></div>

          <template v-if="editingPresets">
            <h2>Edit Times</h2>
            <button class="wtTimerEditCountdown" @click="togglePause" :aria-label="timerPaused ? 'Resume timer' : 'Pause timer'">
              {{ timerDisplay }}
              <svg v-if="!timerPaused && timerSeconds > 0" class="wtTimerPauseIcon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              <svg v-else-if="timerPaused" class="wtTimerPauseIcon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <div class="wtTimerEditTabs">
              <button :class="['wtTimerEditTab', { wtTimerEditTabActive: editTab === 'rest' }]" @click="editTab = 'rest'">Rest Times</button>
              <button :class="['wtTimerEditTab', { wtTimerEditTabActive: editTab === 'alerts' }]" @click="editTab = 'alerts'">Alerts</button>
            </div>
            <div class="wtTimerEditListScroll">
              <template v-if="editTab === 'rest'">
                <div v-for="s in restPresets" :key="s" class="wtTimerEditRow wtTimerEditListItem">
                  <span class="wtTimerEditItemLabel">{{ formatDuration(s) }}</span>
                  <button
                    :class="['glassToggle', { on: !disabledPresets.includes(s) }]"
                    @click="togglePresetEnabled(s)"
                    role="switch"
                    :aria-checked="!disabledPresets.includes(s)"
                    :aria-label="disabledPresets.includes(s) ? 'Enable ' + s : 'Disable ' + s"
                  ><span class="glassToggleThumb"></span></button>
                  <button
                    class="wtTimerEditDeleteBtn"
                    :disabled="restPresets.length <= 1"
                    @click="removePreset(s)"
                    :aria-label="'Remove ' + formatDuration(s) + ' preset'"
                  >&times;</button>
                </div>
              </template>
              <template v-else>
                <div v-for="s in warningOptions" :key="s" class="wtTimerEditRow wtTimerEditListItem">
                  <span class="wtTimerEditItemLabel">{{ s }}s before</span>
                  <button
                    :class="['glassToggle', { on: warningTimes.includes(s) }]"
                    @click="toggleWarningTime(s)"
                    role="switch"
                    :aria-checked="warningTimes.includes(s)"
                    :aria-label="warningTimes.includes(s) ? 'Disable ' + s + 's alert' : 'Enable ' + s + 's alert'"
                  ><span class="glassToggleThumb"></span></button>
                  <button
                    class="wtTimerEditDeleteBtn"
                    :disabled="warningOptions.length <= 1"
                    @click="removeWarningOption(s)"
                    :aria-label="'Remove ' + s + 's warning'"
                  >&times;</button>
                </div>
              </template>
            </div>
            <div v-if="editTab === 'rest'" class="wtTimerEditRow" style="margin-top: var(--space-2)">
              <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="newPresetValue" placeholder="Add seconds" min="5" max="600" @keyup.enter="addPreset" ref="presetInputEl" aria-label="Timer preset seconds" />
              <button class="wtTimerEditAddBtn" :disabled="!newPresetValue" @click="addPreset">Add</button>
            </div>
            <div v-else class="wtTimerEditRow" style="margin-top: var(--space-2)">
              <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="newWarningValue" placeholder="Add seconds" min="1" max="120" @keyup.enter="addWarningOption" aria-label="Warning alert seconds" />
              <button class="wtTimerEditAddBtn" :disabled="!newWarningValue" @click="addWarningOption">Add</button>
            </div>
            <button class="wtTimerEditResetBtn" @click="resetAllDefaults">Reset to defaults</button>
            <button class="wtTimerEditResetBtn wtTimerDisableBtn" @click="disableRestTimer">Disable Rest Timer</button>
            <div class="repMaxActions">
              <button class="repMaxBtn repMaxBtnCalc" @click="editingPresets = false">Done</button>
            </div>
          </template>

          <template v-else>
          <p v-if="selectedExerciseName" class="wtTimerExName">{{ selectedExerciseName }}</p>

          <!-- Circular progress ring -->
          <div :class="['wtTimerRingWrap', { wtTimerRingUrgent: timerUrgent }]">
            <svg class="wtTimerRing" viewBox="0 0 200 200" aria-hidden="true">
              <circle class="wtTimerRingBg" cx="100" cy="100" r="88" />
              <circle
                class="wtTimerRingFill"
                cx="100" cy="100" r="88"
                :stroke-dasharray="2 * Math.PI * 88"
                :stroke-dashoffset="2 * Math.PI * 88 * (1 - timerProgress)"
              />
            </svg>
            <div class="wtTimerRingInner" aria-hidden="true">
              <span :class="['wtTimerTime', { wtTimerTimeDone: timerSeconds === 0 }]">{{ timerDisplay }}</span>
              <span class="wtTimerLabel">{{ timerSeconds === 0 ? 'Done' : 'remaining' }}</span>
            </div>
            <span class="srOnly" aria-live="polite" aria-atomic="true">{{ timerAnnouncement }}</span>
          </div>

          <!-- Play / Pause / Restart -->
          <div class="wtTimerControls">
            <button v-if="timerSeconds === 0" class="wtTimerControlBtn" @click="restartTimer" aria-label="Restart">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
            <button v-else-if="timerPaused" class="wtTimerControlBtn" @click="togglePause" aria-label="Resume">
              <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button v-else class="wtTimerControlBtn" @click="togglePause" aria-label="Pause">
              <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            </button>
          </div>

          <!-- Duration presets -->
          <div class="wtTimerPresets">
            <button
              v-for="s in visiblePresets"
              :key="s"
              :class="['wtTimerPreset', { wtTimerPresetActive: restDuration === s }]"
              @click="setRestDuration(s)"
            >{{ formatDuration(s) }}</button>
          </div>

          <!-- Actions -->
          <div class="repMaxActions">
            <button v-if="selectedExerciseName" class="repMaxBtn repMaxBtnCalc" @click="skipToNextSet">Log Next</button>
            <button class="repMaxBtn repMaxBtnClose" @click="closeModal">Done</button>
          </div>
          <div class="wtTimerFooter">
            <button class="wtTimerFooterLink" @click="editingPresets = true" aria-label="Timer settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="wtTimerFooterLink wtTimerStopLink" @click="dismissTimer">Stop</button>
          </div>
          </template>
        </template>

        <!-- Log / edit form -->
        <template v-else>
          <div class="wtModalHeader">
            <h2 id="log-modal-title">{{ modalTitle }}</h2>
            <button v-if="isLogForExercise" class="wtPlateSettingsBtn" @click="emit('open-edit-exercise', store.exercises.find(e => e.id === selectedExerciseId)!)" aria-label="Exercise settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>

          <!-- New exercise mode: name + tags input -->
          <template v-if="!isEditMode && selectedExerciseId === '__new__'">
            <label class="repMaxLabel">
              Exercise name
              <div class="repMaxInputRow">
                <input
                  v-model.trim="newExerciseName"
                  type="text"
                  placeholder="e.g. Bench Press"
                  class="repMaxInput"
                  maxlength="50"
                  autocomplete="off"
                />
              </div>
            </label>
            <div class="repMaxLabel">
              Tags
              <div class="wtTagPicker">
                <button
                  v-for="tag in allNewExerciseTags"
                  :key="tag"
                  :class="['wtTagPickerChip', { wtTagPickerChipActive: newExerciseTags.includes(tag) }]"
                  :style="!newExerciseTags.includes(tag)
                    ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                    : {}"
                  @click="toggleNewExerciseTag(tag)"
                >{{ tag }}</button>
                <span v-if="newTagAdding" class="wtTagInlineAdd">
                  <input
                    v-model.trim="newExerciseTagInput"
                    type="text"
                    autocomplete="off"
                    placeholder="Tag name"
                    maxlength="30"
                    class="wtTagInlineInput"
                    ref="newTagInputEl"
                    aria-label="New tag name"
                    @keyup.enter="addNewExerciseTag"
                    @blur="finishNewTagAdd"
                  />
                </span>
                <button v-else class="wtTagPickerChip wtTagAddChip" @mousedown.prevent @click="startNewTagAdd" aria-label="Add tag">+</button>
              </div>
            </div>
            <!-- Plate calculator settings for new exercise -->
            <div class="iosSettingsSection">
              <span class="iosSettingsHeader">Input Mode</span>
              <div class="iosSettingsGroup">
                <div class="iosSettingsRow">
                  <span class="iosSettingsRowLabel">Plate calculator</span>
                  <button
                    class="iosToggle"
                    :class="{ iosToggleOn: newExercisePlateMode }"
                    role="switch"
                    :aria-checked="newExercisePlateMode"
                    @click="newExercisePlateMode = !newExercisePlateMode"
                  >
                    <span class="iosToggleKnob"></span>
                  </button>
                </div>
                <template v-if="newExercisePlateMode">
                  <div class="iosSettingsRow">
                    <span class="iosSettingsRowLabel">Counting</span>
                    <div class="iosSegmentedControl">
                      <button
                        :class="['iosSegment', { iosSegmentActive: newExercisePlateCountMode === 'per-side' }]"
                        @click="newExercisePlateCountMode = 'per-side'"
                      >Per side</button>
                      <button
                        :class="['iosSegment', { iosSegmentActive: newExercisePlateCountMode === 'total' }]"
                        @click="newExercisePlateCountMode = 'total'"
                      >Total</button>
                    </div>
                  </div>
                  <div class="iosSettingsRow">
                    <span class="iosSettingsRowLabel">Starting weight</span>
                    <div class="iosStepper">
                      <button class="iosStepperBtn" @click="newExerciseBarWeight = Math.max(0, newExerciseBarWeight - 5)" aria-label="Decrease weight">−</button>
                      <input
                        v-if="newBarWeightEditing"
                        ref="newBarWeightInputEl"
                        :value="newExerciseBarWeight"
                        type="text"
                        inputmode="numeric"
                        autocomplete="off"
                        class="iosStepperInput"
                        aria-label="Starting weight"
                        @focus="($event.target as HTMLInputElement)?.select(); scrollInputAboveKeyboard($event.target as HTMLElement)"
                        @blur="newExerciseBarWeight = Math.max(0, Math.min(MAX_WEIGHT, Math.round(Number(($event.target as HTMLInputElement).value) || 0))); newBarWeightEditing = false"
                      />
                      <button v-else class="iosStepperValue iosStepperValueTappable" @click="newBarWeightEditing = true; nextTick(() => newBarWeightInputEl?.focus())">{{ newExerciseBarWeight }} {{ weightUnit }}</button>
                      <button class="iosStepperBtn" @click="newExerciseBarWeight = Math.min(MAX_WEIGHT, newExerciseBarWeight + 5)" aria-label="Increase weight">+</button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>

          <!-- Date as subtitle (tappable) -->
          <p v-else-if="isLogForExercise || isEditMode" class="wtModalSubtitle">
            <span class="wtDateBtnWrap">
              <span class="wtDateMetaLabel" aria-hidden="true">{{ dateDisplay }}</span>
              <input
                v-model="date"
                type="date"
                autocomplete="off"
                :max="todayISO()"
                tabindex="-1"
                class="wtDateOverlayInput"
                :aria-label="'Log date, currently ' + dateDisplay"
                @click="tryShowDatePicker"
              />
            </span>
          </p>

          <!-- Recent sets (quick-fill) -->
          <div v-if="!isEditMode && isLogForExercise && recentSets.length > 0" class="wtPrevSession">
            <span class="wtPrevSessionLabel">Recent</span>
            <div class="wtPrevSessionChips">
              <button
                v-for="(s, i) in recentSets"
                :key="i"
                class="wtPrevSessionChip"
                @click="fillFromPrevious(s)"
              >{{ displayWeight(s.weight) }} × {{ s.reps }}</button>
            </div>
          </div>

          <!-- Weight + Reps (primary inputs — keep at top for keyboard visibility) -->
          <div v-if="selectedExerciseId === '__new__'" class="wtSectionDivider">
            <span class="wtSectionDividerLine"></span>
            <span class="wtSectionDividerText">Log a set (optional)</span>
            <span class="wtSectionDividerLine"></span>
          </div>
          <!-- Live 1RM estimate / PR target -->
          <div v-if="liveEstimate" class="repMaxResult">
            <span class="repMaxResultLabel">Estimated 1RM{{ liveXPPreview?.best1RM ? ` (Best: ${liveXPPreview.best1RM} ${weightUnit})` : '' }}</span>
            <span class="repMaxResultValue">{{ liveEstimate }} {{ weightUnit }}</span>
            <span v-if="isNewPR" class="wtPrBadge">New PR! 🏆</span>
            <span v-if="liveXPPreview" class="wtXPPreview">{{ liveXPPreview.zone }}{{ liveXPPreview.isRepPR ? ` · Rep PR (${XP_CONFIG.repPRMultiplier}x)` : liveXPPreview.isNewWeight ? ' · New weight' : '' }} · {{ liveXPPreview.xp }} XP</span>
          </div>
          <div v-else-if="prTargetWeight" class="repMaxResult repMaxResultTarget" :class="{ repMaxResultTappable: plateMode }" @click="plateMode && loadPRTarget()">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ prTargetWeight }} {{ weightUnit }} × {{ reps }}</span>
            <span v-if="bestWeightAtReps" class="repMaxPersonalBest">Your best at {{ reps }} rep{{ reps === 1 ? '' : 's' }}: {{ displayWeight(bestWeightAtReps) }} {{ weightUnit }}</span>
            <span v-if="plateMode" class="repMaxPersonalBest">Tap to load plates</span>
          </div>
          <div v-else-if="prTargetReps === 0" class="repMaxResult repMaxResultTarget repMaxResultTappable" @click="repsStr = '1'">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ displayWeight(toLbs(weight!)) }} {{ weightUnit }} × 1 🏆</span>
            <span class="repMaxPersonalBest">Any rep at this weight is a new PR</span>
            <span class="repMaxPersonalBest">Tap to set reps</span>
          </div>
          <div v-else-if="prTargetReps" class="repMaxResult repMaxResultTarget repMaxResultTappable" @click="loadPRTargetReps">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ displayWeight(toLbs(weight!)) }} {{ weightUnit }} × {{ prTargetReps }}</span>
            <span v-if="bestRepsAtWeight" class="repMaxPersonalBest">Your best at {{ displayWeight(toLbs(weight!)) }} {{ weightUnit }}: {{ bestRepsAtWeight }} rep{{ bestRepsAtWeight === 1 ? '' : 's' }}</span>
            <span v-else class="repMaxPersonalBest">New weight — first attempt at {{ displayWeight(toLbs(weight!)) }} {{ weightUnit }}</span>
            <span class="repMaxPersonalBest">Tap to set reps</span>
          </div>
          <div v-else-if="!isEditMode && isLogForExercise" class="repMaxResult repMaxResultPlaceholder">
            <span class="repMaxResultLabel">Estimated 1RM</span>
            <span class="repMaxResultPlaceholderText">Enter weight and reps to see estimate</span>
          </div>

          <!-- PR Targets card -->
          <div v-if="!isEditMode && isLogForExercise && prTargetsTable" :class="['wtPrTargets', { wtPrTargetsExpanded: prTableExpanded }]">
            <button class="wtPrTargetsHeader" @click="prTableExpanded = !prTableExpanded" :aria-expanded="prTableExpanded">
              <span class="wtPrTargetsTitleCol">
                <span class="wtPrTargetsTitle">PR Targets</span>
                <span class="wtPrTargetsSub">
                  Beat {{ displayWeight(store.getExercisePR(selectedExerciseId, prBaselineDate)) }} {{ weightUnit }} e1RM
                  <span class="wtPrTargetsSubDot">·</span>
                  <span class="wtPrTargetsSubCount">{{ prTargetsTable.length }} targets 🏆</span>
                </span>
              </span>
              <svg :class="['wtPrTargetsChevron', { wtPrTargetsChevronOpen: prTableExpanded }]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div v-if="prTableExpanded" class="wtPrTargetsList">
              <button
                v-for="row in prTargetsTable"
                :key="row.reps"
                :class="['wtPrTargetsRow', { wtPrTargetsRowActive: reps !== null && row.reps === reps }]"
                @click="fillFromPRTable(row)"
              >
                <span class="wtPrTargetsReps">{{ row.reps }}</span>
                <span class="wtPrTargetsRepsLabel">{{ row.reps === 1 ? 'rep' : 'reps' }}</span>
                <span class="wtPrTargetsWeight">{{ row.displayWt }} {{ weightUnit }}</span>
                <span class="wtPrTargetsE1rm">~{{ row.e1rm }} e1RM</span>
              </button>
            </div>
          </div>

          <!-- Primary WEIGHT + REPS cards -->
          <div class="wtInputRow logSetFieldsRow">
            <label :class="['repMaxLabel', 'logSetField', 'logSetFieldWeight', { logSetFieldActive: weightHasValue }]">
              <span class="logSetFieldLabel">Weight <span class="logSetFieldLabelUnit">({{ weightUnit }})</span></span>
              <div class="logSetFieldValueRow">
                <input
                  ref="weightInputEl"
                  v-model="weightStr"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="135"
                  class="repMaxInput logSetFieldInput"
                  aria-label="Weight"
                />
                <button
                  v-if="weightHasValue"
                  type="button"
                  class="logSetFieldClear"
                  aria-label="Clear weight"
                  @click.prevent="clearWeight"
                >×</button>
              </div>
            </label>

            <div :class="['repMaxLabel', 'logSetField', 'logSetFieldReps', { logSetFieldActive: reps !== null && reps > 0 }]">
              <span class="logSetFieldLabel">Reps</span>
              <input
                v-model="repsStr"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="—"
                class="repMaxInput logSetFieldInput logSetFieldInputReps"
                aria-label="Reps"
              />
              <div class="logSetFieldStepRow">
                <button
                  type="button"
                  class="logSetStepBtn"
                  :disabled="reps === null || reps <= 0"
                  aria-label="Decrease reps"
                  @click="adjustReps(-1)"
                >−</button>
                <button
                  type="button"
                  class="logSetStepBtn logSetStepBtnPrimary"
                  :disabled="reps !== null && reps >= MAX_REPS"
                  aria-label="Increase reps"
                  @click="adjustReps(1)"
                >+</button>
              </div>
            </div>
          </div>

          <!-- One-time hint: plate calculator discoverability (LIFT-388) -->
          <div
            v-if="showPlateHint"
            class="wtPlateHint"
            role="button"
            tabindex="0"
            @click="openSettingsFromHint"
            @keydown.enter="openSettingsFromHint"
          >
            <svg class="wtPlateHintIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span class="wtPlateHintText">Tip: Enable the plate calculator in exercise settings</span>
            <button class="wtPlateHintDismiss" @click.stop="dismissPlateHint" aria-label="Dismiss hint">×</button>
          </div>

          <!-- Plate calculator -->
          <div v-if="plateMode && !isEditMode" class="wtPlateCalc wtPlateCard">
            <div class="wtPlateCardHeader">
              <span class="wtPlateCardHeaderLabel">{{ isPerSide ? `PER SIDE · ${currentBarWeight} ${weightUnit} BAR` : `TOTAL · ${currentBarWeight} ${weightUnit} BAR` }}</span>
            </div>
            <div class="wtPlateGrid">
              <div v-for="denom in activeDenominations" :key="denom" class="wtPlateCol">
                <button class="wtPlateBtn wtPlateBtnAdd" @click="addPlate(denom)" :aria-label="`Add ${denom} ${weightUnit}`">+{{ denom }}</button>
                <div class="wtPlateCountBox" :class="{ wtPlateCountActive: plateCounts.get(denom) }">
                  <span class="wtPlateCountNum">{{ plateCounts.get(denom) || 0 }}</span>
                </div>
                <button class="wtPlateBtn wtPlateBtnRemove" :class="{ wtPlateBtnRemoveDim: !currentPlates.includes(denom) }" @click="removePlate(denom)" :disabled="!currentPlates.includes(denom)" :aria-label="`Remove ${denom} ${weightUnit}`">−{{ denom }}</button>
              </div>
            </div>
          </div>

          <!-- Actions (always last) -->
          <div class="repMaxActions">
            <button class="repMaxBtn repMaxBtnCalc" :disabled="!canSave" @click="saveSet">
              {{ isEditMode ? 'Save Changes' : (selectedExerciseId === '__new__' && !hasSetData ? 'Add Exercise' : 'Save') }}
            </button>
            <button class="repMaxBtn repMaxBtnClose" @click="closeModal">{{ isEditMode ? 'Cancel' : 'Done' }}</button>
          </div>

        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useProgressionStore } from '../stores/progression'
import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useRestTimer } from '../composables/useRestTimer'
import { useUndoToast } from '../composables/useUndoToast'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import { useFocusTrap } from '../composables/useFocusTrap'
import { useHaptics } from '../composables/useHaptics'
import { usePRBaseline } from '../composables/usePRBaseline'
import { usePRBurst } from '../composables/usePRBurst'
import { useNotification, useBackgroundTracker } from '../composables/useNotification'
import { useWakeLock } from '../composables/useWakeLock'
import { usePreferencesStore } from '../stores/preferences'
import { useXPCeremony } from '../composables/useXPCeremony'
import { platesToWeight, weightToPlates, LBS_PLATES, KG_PLATES } from '../lib/plateCalculator'
import { calculateSetXP, calculateBest1RM, applyStreakMultiplier, checkRepPR, isExerciseEstablished, XP_CONFIG } from '../lib/xp'
import { toLocalDateKey } from '../lib/sessionSummary'
import type { Exercise, WorkoutSet, PlateCountMode } from '../stores/workout'

const emit = defineEmits<{
  closed: []
  saved: []
  'open-edit-exercise': [exercise: Exercise]
}>()

const store = useWorkoutStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { currentTheme } = useTheme()
const { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled } = useRestTimer()
const { weightUnit, displayWeight, toLbs } = useWeightUnit()
const { impactLight, notifySuccess } = useHaptics()
const { logSetXPCeremony } = useXPCeremony()
const { prBaselineDate } = usePRBaseline()
const { presentPRBurst } = usePRBurst()
const { notify: sendNotification, requestPermission: requestNotificationPermission } = useNotification()
const { wasBackgrounded, startTracking: startBgTracking, stopTracking: stopBgTracking } = useBackgroundTracker()
const _prefs = usePreferencesStore()
const wakeLockEnabled = computed(() => _prefs.experience.screenWakeLock !== false)

// ── Utility functions ────────────────────────────────────────────
function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function filterSetsSinceBaseline<T extends { date: string }>(sets: T[]): T[] {
  const baseline = prBaselineDate.value
  if (!baseline) return sets
  return sets.filter(s => s.date.slice(0, 10) >= baseline)
}

// ── Swipe-to-dismiss ─────────────────────────────────────────────
const logSheetEl = ref<HTMLElement | null>(null)
const logSheetHandleEl = ref<HTMLElement | null>(null)
const logSwipe = useSwipeToDismiss({
  threshold: 100,
  onDismiss: () => closeModal(),
})

const logModalFocus = useFocusTrap()

// ── Wake Lock ────────────────────────────────────────────────────
const showModal = ref(false)
const wakeLockNeeded = computed(() => timerActive.value || showModal.value)
useWakeLock(wakeLockNeeded, wakeLockEnabled)

// ── Log / Edit modal state ───────────────────────────────────────
const weightInputEl = ref<HTMLInputElement | null>(null)
const editingSet = ref<{ exerciseId: string; setId: string } | null>(null)
const selectedExerciseId = ref('')

// ── Previous sets for quick-fill ─────────────────────────────────
const RECENT_SET_LIMIT = 5

const recentSets = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  if (!ex || ex.sets.length === 0) return []
  const today = todayISO()
  const prior = [...ex.sets]
    .filter(s => toLocalDateKey(s.date) !== today)
    .sort((a, b) => b.date.localeCompare(a.date))
  const seen = new Set<string>()
  const result: { weight: number; reps: number }[] = []
  for (const s of prior) {
    const key = `${s.weight}x${s.reps}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ weight: s.weight, reps: s.reps })
    }
    if (result.length >= RECENT_SET_LIMIT) break
  }
  return result
})

function fillFromPrevious(set: { weight: number; reps: number }) {
  weightStr.value = String(displayWeight(set.weight))
  repsStr.value = String(set.reps)
}

// ── Plate calculator state ───────────────────────────────────────
const currentPlates = ref<number[]>([])
const previousPlates = ref<number[]>([])

const plateMode = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  return ex?.inputMode === 'plates'
})
const plateNumpadOverride = ref(false)

// ── Plate calculator hint (LIFT-388) ─────────────────────────────
const PLATE_HINT_KEY = 'plate-calc-hint-dismissed'
const plateHintDismissed = ref(!!localStorage.getItem(PLATE_HINT_KEY))

const showPlateHint = computed(() =>
  !plateHintDismissed.value &&
  !plateMode.value &&
  !isEditMode.value &&
  isLogForExercise.value
)

function dismissPlateHint() {
  plateHintDismissed.value = true
  localStorage.setItem(PLATE_HINT_KEY, 'true')
}

function openSettingsFromHint() {
  dismissPlateHint()
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  if (ex) emit('open-edit-exercise', ex)
}

function adjustReps(delta: number) {
  const current = reps.value ?? 0
  const next = Math.max(0, Math.min(MAX_REPS, current + delta))
  if (next === 0) {
    repsStr.value = ''
  } else {
    repsStr.value = String(next)
  }
}

function clearWeight() {
  weightStr.value = ''
  weightInputEl.value?.focus()
}

const weightHasValue = computed(() => weightStr.value.trim().length > 0)

function loadPRTarget() {
  if (!prTargetWeight.value) return
  const targetLbs = toLbs(prTargetWeight.value)
  const denoms = weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
  const barWt = currentBarWeight.value
  const smallestIncrement = denoms[denoms.length - 1] * (isPerSide.value ? 2 : 1)
  const plateWeight = targetLbs - barWt
  if (plateWeight <= 0) {
    currentPlates.value = []
    syncPlateWeight()
    return
  }
  const roundedPlateWeight = Math.ceil(plateWeight / smallestIncrement) * smallestIncrement
  const roundedTotal = barWt + roundedPlateWeight
  const plates = weightToPlates(roundedTotal, barWt, denoms)
  if (plates) {
    currentPlates.value = plates
    syncPlateWeight()
  }
}

function loadPRTargetReps() {
  if (!prTargetReps.value || prTargetReps.value < 1) return
  repsStr.value = String(prTargetReps.value)
}

const currentBarWeight = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  if (ex?.barWeight !== undefined) return ex.barWeight
  return isPerSide.value ? 45 : 0
})

const isPerSide = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  return (ex?.plateCountMode ?? 'per-side') === 'per-side'
})

const activeDenominations = computed(() =>
  weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
)

const plateCounts = computed(() => {
  const counts = new Map<number, number>()
  for (const p of currentPlates.value) counts.set(p, (counts.get(p) || 0) + 1)
  return counts
})

const plateWeightLbs = computed(() => {
  if (isPerSide.value) {
    return platesToWeight(currentPlates.value, currentBarWeight.value)
  }
  const plateSum = currentPlates.value.reduce((s, p) => s + p, 0)
  return currentBarWeight.value + plateSum
})

function syncPlateWeight() {
  _plateSync = true
  weight.value = displayWeight(plateWeightLbs.value)
  nextTick(() => { _plateSync = false })
}

let _plateSync = false

function syncPlatesFromWeight() {
  if (_plateSync || !plateMode.value) return
  const w = weight.value
  if (w === null || w <= 0) {
    currentPlates.value = []
    return
  }
  const lbs = toLbs(w)
  const denoms = weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
  const plates = weightToPlates(lbs, currentBarWeight.value, denoms)
  currentPlates.value = plates || []
}

function addPlate(denom: number) {
  const preview = [...currentPlates.value, denom]
  const previewWeight = isPerSide.value
    ? platesToWeight(preview, currentBarWeight.value)
    : currentBarWeight.value + preview.reduce((s, p) => s + p, 0)
  if (previewWeight > MAX_WEIGHT) return
  currentPlates.value = preview.sort((a, b) => b - a)
  syncPlateWeight()
}

function removePlate(denom: number) {
  const idx = currentPlates.value.indexOf(denom)
  if (idx === -1) return
  const updated = [...currentPlates.value]
  updated.splice(idx, 1)
  currentPlates.value = updated
  syncPlateWeight()
}

// ── New exercise state ───────────────────────────────────────────
const newExerciseName = ref('')
const newExerciseTags = ref<string[]>([])
const newExerciseTagInput = ref('')
const newExercisePlateMode = ref(false)
const newExercisePlateCountMode = ref<PlateCountMode>('per-side')
const newExerciseBarWeight = ref(45)
const newBarWeightEditing = ref(false)
const newBarWeightInputEl = ref<HTMLInputElement | null>(null)
const prTableExpanded = ref(false)

// String-based raw inputs to avoid iOS keyboard dismissal
const weightStr = ref('')
const repsStr = ref('')
const weight = computed<number | null>({
  get: () => { const n = parseFloat(weightStr.value); return isNaN(n) ? null : n },
  set: (v) => { weightStr.value = v === null ? '' : String(v) },
})
const reps = computed<number | null>({
  get: () => { const n = parseInt(repsStr.value); return isNaN(n) ? null : n },
  set: (v) => { repsStr.value = v === null ? '' : String(v) },
})

// Sync plate display when weight changes from input/chips
watch(weightStr, () => {
  if (plateMode.value && !_plateSync) syncPlatesFromWeight()
})

const date = ref(todayISO())
const lastLogDate = ref(todayISO())

function tryShowDatePicker(e: MouseEvent) {
  const el = e.currentTarget as HTMLInputElement
  try { el.showPicker() } catch { /* unsupported */ }
}

const dateDisplay = computed(() => {
  if (!date.value) return 'Today'
  const today = todayISO()
  if (date.value === today) return 'Today'
  const prev = new Date()
  prev.setDate(prev.getDate() - 1)
  const yest = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
  if (date.value === yest) return 'Yesterday'
  return new Date(date.value + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
})

const isEditMode = computed(() => editingSet.value !== null)

const isLogForExercise = computed(() =>
  !isEditMode.value &&
  selectedExerciseId.value !== '' &&
  selectedExerciseId.value !== '__new__'
)

const selectedExerciseName = computed(() =>
  store.exercises.find(e => e.id === selectedExerciseId.value)?.name ?? ''
)

const modalTitle = computed(() => {
  if (isEditMode.value) return 'Edit Set'
  if (selectedExerciseId.value === '__new__') return 'New Exercise'
  return selectedExerciseName.value || 'Log a Set'
})

// ── New exercise tag helpers ─────────────────────────────────────
const newTagInputEl = ref<HTMLInputElement | null>(null)
const newTagAdding = ref(false)

function startNewTagAdd() {
  newTagAdding.value = true
  nextTick(() => newTagInputEl.value?.focus())
}

function addNewExerciseTag() {
  const tag = newExerciseTagInput.value.trim()
  if (tag) {
    if (!newExerciseSessionTags.value.includes(tag)) newExerciseSessionTags.value.push(tag)
    if (!newExerciseTags.value.includes(tag)) newExerciseTags.value.push(tag)
  }
  newExerciseTagInput.value = ''
  nextTick(() => newTagInputEl.value?.focus())
}

function finishNewTagAdd() {
  const tag = newExerciseTagInput.value.trim()
  if (tag) {
    if (!newExerciseSessionTags.value.includes(tag)) newExerciseSessionTags.value.push(tag)
    if (!newExerciseTags.value.includes(tag)) newExerciseTags.value.push(tag)
  }
  newExerciseTagInput.value = ''
  newTagAdding.value = false
}

const newExerciseSessionTags = ref<string[]>([])

const allNewExerciseTags = computed(() => {
  const all = new Set([...store.allTags, ...newExerciseTags.value, ...newExerciseSessionTags.value])
  return [...all]
})

function toggleNewExerciseTag(tag: string) {
  if (newExerciseTags.value.includes(tag)) {
    newExerciseTags.value = newExerciseTags.value.filter(t => t !== tag)
  } else {
    newExerciseTags.value.push(tag)
  }
}

// ── Open methods ─────────────────────────────────────────────────
function openForNew() {
  editingSet.value = null
  selectedExerciseId.value = '__new__'
  newExerciseTags.value = []
  newExerciseSessionTags.value = []
  newExerciseTagInput.value = ''
  newExercisePlateMode.value = false
  newExercisePlateCountMode.value = 'per-side'
  newExerciseBarWeight.value = 45
  date.value = lastLogDate.value
  showModal.value = true
}

function openForExercise(exerciseId: string) {
  editingSet.value = null
  selectedExerciseId.value = exerciseId
  date.value = lastLogDate.value
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (exercise?.inputMode === 'plates') {
    const lastSet = exercise.sets.length > 0 ? exercise.sets[exercise.sets.length - 1] : null
    if (lastSet) {
      const barWt = exercise.barWeight ?? 45
      const plates = weightToPlates(lastSet.weight, barWt, weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES)
      currentPlates.value = plates || []
      previousPlates.value = plates || []
      weight.value = displayWeight(lastSet.weight)
    } else {
      currentPlates.value = []
      previousPlates.value = []
    }
  } else {
    currentPlates.value = []
    previousPlates.value = []
  }
  showModal.value = true
}

function openForEdit(exercise: Exercise, set: WorkoutSet) {
  editingSet.value = { exerciseId: exercise.id, setId: set.id }
  selectedExerciseId.value = exercise.id
  date.value = isoToLocalDate(set.date)
  weight.value = displayWeight(set.weight)
  reps.value = set.reps
  showModal.value = true
}

function closeModal() {
  if (!isEditMode.value) {
    lastLogDate.value = date.value
  }
  showModal.value = false
  editingPresets.value = false
  editingSet.value = null
  selectedExerciseId.value = ''
  newExerciseName.value = ''
  newExerciseTags.value = []
  newExerciseSessionTags.value = []
  newExerciseTagInput.value = ''
  weight.value = null
  reps.value = null
  date.value = todayISO()
  plateNumpadOverride.value = false
  prTableExpanded.value = false
  emit('closed')
}

// ── Rest timer ───────────────────────────────────────────────────
const timerActive = ref(false)
const timerPaused = ref(false)
const timerSeconds = ref(0)
const timerAnnouncement = ref('')
const restDuration = ref(parseInt(localStorage.getItem('rest-duration') ?? '90') || 90)
let timerIntervalId: ReturnType<typeof setInterval> | null = null
let timerEndTime = 0
let pausedRemaining = 0
let lastWarnedAt = -1

const DEFAULT_WARNING_OPTIONS = [3, 5, 10, 15, 30]
const warningOptions = ref<number[]>(loadWarningOptions())
const warningTimes = ref<number[]>(loadWarningTimes())
const newWarningValue = ref<number | null>(null)

function loadWarningOptions(): number[] {
  try {
    const raw = localStorage.getItem('rest-warning-options')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.sort((a, b) => a - b)
    }
  } catch { /* ignore */ }
  return [...DEFAULT_WARNING_OPTIONS]
}

function saveWarningOptions() {
  localStorage.setItem('rest-warning-options', JSON.stringify(warningOptions.value))
}

function loadWarningTimes(): number[] {
  try {
    const raw = localStorage.getItem('rest-warnings')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return [5]
}

function toggleWarningTime(val: number) {
  if (val === 0) {
    warningTimes.value = []
  } else if (warningTimes.value.includes(val)) {
    warningTimes.value = warningTimes.value.filter(v => v !== val)
  } else {
    warningTimes.value = [...warningTimes.value, val].sort((a, b) => a - b)
  }
  localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
}

function addWarningOption() {
  if (newWarningValue.value === null) return
  const val = newWarningValue.value
  if (val >= 1 && val <= 120 && !warningOptions.value.includes(val)) {
    warningOptions.value = [...warningOptions.value, val].sort((a, b) => a - b)
    saveWarningOptions()
  }
  newWarningValue.value = null
}

function removeWarningOption(val: number) {
  if (warningOptions.value.length <= 1) return
  warningOptions.value = warningOptions.value.filter(v => v !== val)
  warningTimes.value = warningTimes.value.filter(v => v !== val)
  saveWarningOptions()
  localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
}

function formatTimerAnnouncement(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0 && s > 0) return `${m} minute${m > 1 ? 's' : ''} ${s} second${s !== 1 ? 's' : ''}`
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''}`
  return `${s} second${s !== 1 ? 's' : ''}`
}

function startInterval() {
  if (timerIntervalId !== null) clearInterval(timerIntervalId)
  lastWarnedAt = -1
  timerIntervalId = setInterval(() => {
    if (!timerPaused.value) {
      const remaining = Math.ceil((timerEndTime - Date.now()) / 1000)
      const prev = timerSeconds.value
      timerSeconds.value = Math.max(remaining, 0)
      for (const w of warningTimes.value) {
        if (w < prev && w >= timerSeconds.value && w !== lastWarnedAt) {
          lastWarnedAt = w
          playWarningBeep(w)
          timerAnnouncement.value = `${formatTimerAnnouncement(w)} remaining`
        }
      }
      if (timerSeconds.value <= 0) {
        playGoBeep()
        if (timerIntervalId !== null) clearInterval(timerIntervalId)
        timerIntervalId = null
        timerSeconds.value = 0
        timerAnnouncement.value = 'Rest timer done'
        if (_prefs.experience.restTimerNotification) {
          sendNotification('Rest Complete', {
            body: 'Time to get back to work 💪',
            wasBackgrounded: wasBackgrounded.value,
          })
        }
        stopBgTracking()
        if (!editingPresets.value) {
          onTimerComplete()
        }
      }
    }
  }, 250)
}

function startRestTimer() {
  ensureAudioCtx()
  if (_prefs.experience.restTimerNotification) {
    requestNotificationPermission()
    startBgTracking()
  }
  timerActive.value = true
  timerPaused.value = false
  timerSeconds.value = restDuration.value
  timerEndTime = Date.now() + restDuration.value * 1000
  timerAnnouncement.value = `Rest timer started, ${formatTimerAnnouncement(restDuration.value)}`
  startInterval()
}

function togglePause() {
  ensureAudioCtx()
  if (!timerPaused.value) {
    pausedRemaining = Math.max(Math.ceil((timerEndTime - Date.now()) / 1000), 0)
    timerPaused.value = true
  } else {
    timerEndTime = Date.now() + pausedRemaining * 1000
    timerPaused.value = false
  }
}

const timerStopping = ref(false)

function stopTimer() {
  timerStopping.value = true
  if (timerIntervalId !== null) clearInterval(timerIntervalId)
  timerIntervalId = null
  timerActive.value = false
  timerPaused.value = false
  timerSeconds.value = 0
  editingPresets.value = false
  newPresetValue.value = null
  setTimeout(() => { timerStopping.value = false }, 0)
}

function restartTimer() {
  ensureAudioCtx()
  timerSeconds.value = restDuration.value
  timerEndTime = Date.now() + restDuration.value * 1000
  timerPaused.value = false
  startInterval()
}

function onTimerComplete() {
  skipToNextSet()
}

function skipToNextSet() {
  stopTimer()
  date.value = lastLogDate.value
}

const DEFAULT_PRESETS = [30, 60, 90, 120, 180, 300]
const editingPresets = ref(false)
const editTab = ref<'rest' | 'alerts'>('rest')
const newPresetValue = ref<number | null>(null)

const restPresets = ref<number[]>(loadPresets())
const disabledPresets = ref<number[]>(loadDisabledPresets())

const visiblePresets = computed(() =>
  restPresets.value.filter(s => !disabledPresets.value.includes(s))
)

function loadDisabledPresets(): number[] {
  try {
    const raw = localStorage.getItem('rest-presets-disabled')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveDisabledPresets() {
  localStorage.setItem('rest-presets-disabled', JSON.stringify(disabledPresets.value))
}

function togglePresetEnabled(val: number) {
  if (disabledPresets.value.includes(val)) {
    disabledPresets.value = disabledPresets.value.filter(v => v !== val)
  } else {
    if (visiblePresets.value.length <= 1) return
    disabledPresets.value = [...disabledPresets.value, val]
  }
  saveDisabledPresets()
}

function loadPresets(): number[] {
  try {
    const raw = localStorage.getItem('rest-presets')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.sort((a, b) => a - b)
    }
  } catch { /* ignore */ }
  return [...DEFAULT_PRESETS]
}

function savePresets() {
  localStorage.setItem('rest-presets', JSON.stringify(restPresets.value))
}

function formatDuration(s: number): string {
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}:${rem.toString().padStart(2, '0')}` : `${m}m`
}

function setRestDuration(val: number) {
  ensureAudioCtx()
  restDuration.value = val
  localStorage.setItem('rest-duration', String(val))
  timerSeconds.value = val
  timerEndTime = Date.now() + val * 1000
  timerPaused.value = false
  startInterval()
}

function addPreset() {
  if (newPresetValue.value === null) return
  const val = newPresetValue.value
  if (val >= 5 && val <= 600 && !restPresets.value.includes(val)) {
    restPresets.value = [...restPresets.value, val].sort((a, b) => a - b)
    savePresets()
  }
  newPresetValue.value = null
}

const presetInputEl = ref<HTMLInputElement | null>(null)
watch(editingPresets, (v) => {
  if (v) setTimeout(() => presetInputEl.value?.focus(), 0)
})

function removePreset(val: number) {
  if (restPresets.value.length <= 1) return
  restPresets.value = restPresets.value.filter(v => v !== val)
  savePresets()
  if (restDuration.value === val) {
    setRestDuration(restPresets.value[0])
  }
}

function resetAllDefaults() {
  restPresets.value = [...DEFAULT_PRESETS]
  savePresets()
  warningOptions.value = [...DEFAULT_WARNING_OPTIONS]
  saveWarningOptions()
  warningTimes.value = [5]
  localStorage.setItem('rest-warnings', JSON.stringify(warningTimes.value))
}

function onOverlayClick() {
  if (editingPresets.value) {
    editingPresets.value = false
  } else {
    closeModal()
  }
}

function dismissTimer() {
  stopTimer()
  closeModal()
}

function disableRestTimer() {
  const hadActiveTimer = timerActive.value
  const wasPaused = timerPaused.value
  const previousSeconds = timerSeconds.value
  const previousDuration = restDuration.value
  setRestTimerEnabled(false)
  dismissTimer()
  showUndo('Rest timer disabled', () => {
    setRestTimerEnabled(true)
    if (hadActiveTimer) {
      timerSeconds.value = previousSeconds
      restDuration.value = previousDuration
      timerActive.value = true
      timerPaused.value = wasPaused
      showModal.value = true
      if (previousSeconds > 0) {
        if (wasPaused) {
          pausedRemaining = previousSeconds
        } else {
          timerEndTime = Date.now() + previousSeconds * 1000
        }
        startInterval()
      }
    }
  }, () => { /* already disabled — no-op on commit */ })
}

function openRestTimer() {
  showModal.value = true
  if (!timerActive.value) {
    startRestTimer()
  }
}

const timerDisplay = computed(() => {
  const m = Math.floor(timerSeconds.value / 60)
  const s = timerSeconds.value % 60
  return `${m}:${s.toString().padStart(2, '0')}`
})

const timerProgress = computed(() => {
  if (restDuration.value <= 0) return 0
  return timerSeconds.value / restDuration.value
})

const maxWarning = computed(() => warningTimes.value.length ? Math.max(...warningTimes.value) : 0)
const timerUrgent = computed(() => maxWarning.value > 0 && timerSeconds.value <= maxWarning.value && timerSeconds.value > 0)

let audioCtx: AudioContext | null = null

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.frequency.value = 1
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05)
  osc.start(audioCtx.currentTime)
  osc.stop(audioCtx.currentTime + 0.05)
}

function playWarningBeep(secondsLeft: number) {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  try {
    const t = audioCtx.currentTime
    const freq = Math.min(1100, 500 + (30 - Math.min(secondsLeft, 30)) * 20)
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.linearRampToValueAtTime(freq + 120, t + 0.2)
    gain.gain.setValueAtTime(0.2, t)
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.25)
  } catch { /* audio not available */ }
}

function playGoBeep() {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  try {
    const t = audioCtx.currentTime
    for (let i = 0; i < 2; i++) {
      const offset = i * 0.18
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.frequency.value = 1320
      gain.gain.setValueAtTime(0.35, t + offset)
      gain.gain.exponentialRampToValueAtTime(0.01, t + offset + 0.1)
      osc.start(t + offset)
      osc.stop(t + offset + 0.1)
    }
  } catch { /* audio not available */ }
}

// ── Live 1RM estimate ────────────────────────────────────────────
const liveEstimate = computed(() => {
  if (!weight.value || weight.value <= 0 || !reps.value || reps.value < 1) return null
  const w = toLbs(weight.value)
  const est = reps.value === 1 ? w : w * (1 + reps.value / 30)
  return displayWeight(Math.round(est))
})

const liveEstimateLbs = computed(() => {
  if (!weight.value || weight.value <= 0 || !reps.value || reps.value < 1) return null
  const w = toLbs(weight.value)
  return reps.value === 1 ? Math.round(w) : Math.round(w * (1 + reps.value / 30))
})

const isNewPR = computed(() => {
  if (!liveEstimateLbs.value || isEditMode.value) return false
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return false
  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return false
  if (!isExerciseEstablished(exercise.sets, date.value || todayISO())) return false
  const pr = store.getExercisePR(id, prBaselineDate.value)
  return pr > 0 && liveEstimateLbs.value > pr
})

// ── PR target suggestions ────────────────────────────────────────
const prTargetWeight = computed<number | null>(() => {
  if (isEditMode.value || !reps.value || reps.value < 1) return null
  if (weight.value && weight.value > 0) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  if (pr <= 0) return null
  const target = pr + 0.5
  const rawLbs = reps.value === 1 ? Math.ceil(target) : Math.ceil(target / (1 + reps.value / 30))
  if (weightUnit.value === 'kg') {
    const rawKg = rawLbs * 0.453592
    const roundedKg = Math.ceil(rawKg / 2.5) * 2.5
    return roundedKg
  }
  const targetLbs = Math.ceil(rawLbs / 5) * 5
  return targetLbs
})

// ── Live XP preview ──────────────────────────────────────────────
// Debounced XP preview — the underlying calculation is expensive (1RM, rep PR,
// streak multiplier) and triggers on every keystroke in weight/reps inputs.
// We debounce by 150ms so the preview updates after the user pauses typing,
// keeping INP low during rapid input. (#632)
type XPPreviewResult = { xp: number; zone: string; best1RM: string | null; isRepPR: boolean; isNewWeight: boolean }
const liveXPPreview = ref<XPPreviewResult | null>(null)
let _xpPreviewTimer: ReturnType<typeof setTimeout> | undefined

function _computeXPPreview(): XPPreviewResult | null {
  if (!progressionStore.progressionEnabled || !progressionStore.showProgression) return null
  if (!liveEstimateLbs.value || isEditMode.value) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null

  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null

  const rawBest1RM = calculateBest1RM(exercise.sets, { sinceDate: prBaselineDate.value })
  const estimated1RM = liveEstimateLbs.value
  const w = toLbs(weight.value!)
  const r = reps.value!

  const isEstablished = isExerciseEstablished(exercise.sets, date.value || todayISO())
  const best1RM = isEstablished ? rawBest1RM : null

  const repPRPriorSets = filterSetsSinceBaseline(exercise.sets)
  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const isRepPR = isEstablished && !isPRZone && checkRepPR(w, r, repPRPriorSets)
  const isNewWeight = !isPRZone && !isRepPR && !repPRPriorSets.some(s => s.weight === w) && best1RM !== null

  const setIndex = exercise.sets.length
  const baseXP = calculateSetXP({
    setEstimated1RM: estimated1RM,
    exerciseBest1RM: best1RM,
    setIndex: best1RM === null ? setIndex : 0,
    isRepPR,
  })
  const xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, new Date().toISOString())

  let zone: string
  if (best1RM === null) {
    zone = 'New Exercise'
  } else {
    const ratio = estimated1RM / best1RM
    if (ratio > 1.0) zone = `PR! (${XP_CONFIG.prMultiplier}x)`
    else if (ratio === 1.0) zone = `Tied PR (${XP_CONFIG.tieMultiplier}x)`
    else if (ratio < XP_CONFIG.warmupThreshold) zone = 'Warmup'
    else zone = `${Math.round(ratio * 100)}% of best`
  }

  return {
    xp,
    zone,
    best1RM: best1RM ? displayWeight(best1RM) : null,
    isRepPR,
    isNewWeight,
  }
}

watch(
  () => [weight.value, reps.value, selectedExerciseId.value, isEditMode.value,
         progressionStore.progressionEnabled, progressionStore.showProgression] as const,
  () => {
    clearTimeout(_xpPreviewTimer)
    // Fast-clear when inputs are obviously invalid (no flicker of stale data)
    if (!weight.value || weight.value <= 0 || !reps.value || reps.value < 1) {
      liveXPPreview.value = null
      return
    }
    _xpPreviewTimer = setTimeout(() => { liveXPPreview.value = _computeXPPreview() }, 150)
  },
)

const prTargetReps = computed<number | null>(() => {
  if (isEditMode.value || !weight.value || weight.value <= 0) return null
  if (reps.value && reps.value >= 1) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  if (pr <= 0) return null
  const wLbs = toLbs(weight.value)
  if (Math.round(wLbs) > pr) return 0
  const needed = Math.ceil(30 * ((pr + 0.5) / wLbs - 1))
  if (needed <= 1 && Math.round(wLbs) <= pr) return 2
  return needed
})

// ── PR targets table ─────────────────────────────────────────────
interface PRTargetRow {
  reps: number
  weightLbs: number
  displayWt: number
  e1rm: number
}

const prTargetsTable = computed<PRTargetRow[] | null>(() => {
  if (isEditMode.value) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null
  if (!isExerciseEstablished(exercise.sets, date.value || todayISO())) return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  if (pr <= 0) return null

  const target = pr + 0.5
  const isPlate = plateMode.value
  const denoms = weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
  const barWt = currentBarWeight.value
  const smallestIncrement = denoms[denoms.length - 1] * (isPerSide.value ? 2 : 1)
  const rows: PRTargetRow[] = []

  for (let r = 1; r <= 20; r++) {
    const rawLbs = r === 1 ? Math.ceil(target) : Math.ceil(target / (1 + r / 30))
    let finalLbs: number
    if (isPlate) {
      const plateWeight = rawLbs - barWt
      if (plateWeight <= 0) {
        finalLbs = barWt
      } else {
        const roundedPlateWeight = Math.ceil(plateWeight / smallestIncrement) * smallestIncrement
        finalLbs = barWt + roundedPlateWeight
      }
    } else if (weightUnit.value === 'kg') {
      const rawKg = rawLbs * 0.453592
      const roundedKg = Math.ceil(rawKg / 2.5) * 2.5
      finalLbs = Math.round(roundedKg / 0.453592)
    } else {
      finalLbs = Math.ceil(rawLbs / 5) * 5
    }

    const e1rm = r === 1 ? finalLbs : Math.round(finalLbs * (1 + r / 30))

    rows.push({
      reps: r,
      weightLbs: finalLbs,
      displayWt: displayWeight(finalLbs),
      e1rm: displayWeight(e1rm),
    })
  }

  return rows
})

function fillFromPRTable(row: PRTargetRow) {
  if (plateMode.value) {
    const denoms = weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
    const barWt = currentBarWeight.value
    const plates = weightToPlates(row.weightLbs, barWt, denoms)
    if (plates) {
      currentPlates.value = plates
      syncPlateWeight()
    }
  } else {
    weightStr.value = String(row.displayWt)
  }
  repsStr.value = String(row.reps)
  prTableExpanded.value = false
  impactLight()
}

// ── Personal bests from history ──────────────────────────────────
const bestRepsAtWeight = computed<number | null>(() => {
  if (!weight.value || weight.value <= 0) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null
  const wLbs = Math.round(toLbs(weight.value))
  let best = 0
  for (const s of exercise.sets) {
    if (Math.round(s.weight) === wLbs && s.reps > best) best = s.reps
  }
  return best > 0 ? best : null
})

const bestWeightAtReps = computed<number | null>(() => {
  if (!reps.value || reps.value < 1) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null
  let best = 0
  for (const s of exercise.sets) {
    if (s.reps === reps.value && s.weight > best) best = s.weight
  }
  return best > 0 ? best : null
})

const MAX_WEIGHT = 2000
const MAX_REPS = 200

function scrollInputAboveKeyboard(el: HTMLElement) {
  setTimeout(() => {
    const modal = el.closest('.repMaxModal') as HTMLElement | null
    if (!modal) return
    const vv = window.visualViewport
    if (!vv) return
    const availableHeight = vv.height - 96
    modal.style.maxHeight = `${availableHeight}px`
    nextTick(() => {
      const inputRect = el.getBoundingClientRect()
      const visibleBottom = vv.offsetTop + vv.height
      if (inputRect.bottom > visibleBottom - 16) {
        modal.scrollTop += inputRect.bottom - visibleBottom + 60
      }
    })
    const restore = () => {
      modal.style.maxHeight = ''
      vv.removeEventListener('resize', restore)
    }
    vv.addEventListener('resize', restore)
  }, 400)
}

const hasSetData = computed(() => weight.value !== null && weight.value > 0 && weight.value <= MAX_WEIGHT && reps.value !== null && reps.value >= 1 && reps.value <= MAX_REPS)

const canSave = computed(() => {
  if (isEditMode.value) return hasSetData.value
  if (selectedExerciseId.value === '__new__') return newExerciseName.value.length > 0
  return selectedExerciseId.value !== '' && hasSetData.value
})

// ── XP computation helper ────────────────────────────────────────
function computeAndLogXP(exerciseId: string, setId: string, estimated1RM: number, setWeight: number, setReps: number) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (!exercise) return

  const otherSets = exercise.sets.filter(s => s.id !== setId)
  const rawBest1RM = calculateBest1RM(otherSets, { sinceDate: prBaselineDate.value })

  const isEstablished = isExerciseEstablished(otherSets, date.value || todayISO())
  const best1RM = isEstablished ? rawBest1RM : null

  const repPRPriorSets = filterSetsSinceBaseline(otherSets)
  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const isRepPR = isEstablished && !isPRZone && checkRepPR(setWeight, setReps, repPRPriorSets)

  const setIndex = exercise.sets.length - 1
  const baseXP = calculateSetXP({
    setEstimated1RM: estimated1RM,
    exerciseBest1RM: best1RM,
    setIndex: best1RM === null ? setIndex : 0,
    isRepPR,
  })

  let zone: 'warmup' | 'working' | 'pr' | 'tie' | 'new_exercise'
  const isPR = best1RM !== null && estimated1RM > best1RM
  const isTie = best1RM !== null && estimated1RM === best1RM
  if (best1RM === null) zone = 'new_exercise'
  else if (isPR) zone = 'pr'
  else if (isTie) zone = 'tie'
  else if (estimated1RM / best1RM < XP_CONFIG.warmupThreshold) zone = 'warmup'
  else zone = 'working'

  const mult = progressionStore.currentMultiplier
  let xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, new Date().toISOString())
  if (xp === baseXP && mult > 1) {
    xp = Math.round(baseXP * mult)
  }
  logSetXPCeremony({
    setId,
    exerciseId,
    xp,
    baseXP,
    zone,
    isPR,
    isTie,
    isRepPR,
    activeTheme: currentTheme.value,
    estimated1RM,
    exerciseBest1RM: best1RM,
    streakMultiplier: mult,
    onUnlock: notifySuccess,
  })
}

// ── Save set ─────────────────────────────────────────────────────
function saveSet() {
  if (!canSave.value) return
  if (isEditMode.value && editingSet.value && weight.value !== null && reps.value !== null) {
    const editExId = editingSet.value.exerciseId
    const editSetId = editingSet.value.setId
    store.updateSet(editExId, editSetId, toLbs(weight.value), reps.value, date.value)
    logEvent('set_edit')
    // Recalc XP for the edited set
    if (progressionStore.progressionEnabled) {
      const ex = store.exercises.find(e => e.id === editExId)
      const set = ex?.sets.find(s => s.id === editSetId)
      if (ex && set) {
        const otherSets = ex.sets.filter(s => s.id !== editSetId)
        const rawBest = calculateBest1RM(otherSets, { sinceDate: prBaselineDate.value })
        const editEstablished = isExerciseEstablished(otherSets, set.date)
        const best = editEstablished ? rawBest : null
        const newXP = calculateSetXP({
          setEstimated1RM: set.estimated1RM,
          exerciseBest1RM: best,
          setIndex: best === null ? ex.sets.indexOf(set) : 0,
        })
        const xp = applyStreakMultiplier(newXP, progressionStore.streakHistory, set.date)
        const editIsPR = best !== null && set.estimated1RM > best
        const editIsTie = best !== null && set.estimated1RM === best
        const editIsPRZone = editIsPR || editIsTie
        const editRepPRPriorSets = filterSetsSinceBaseline(otherSets)
        const editIsRepPR = editEstablished && !editIsPRZone && checkRepPR(set.weight, set.reps, editRepPRPriorSets)
        let editZone: string
        if (best === null) editZone = 'new_exercise'
        else if (editIsPR) editZone = 'pr'
        else if (editIsTie) editZone = 'tie'
        else if (set.estimated1RM / best < XP_CONFIG.warmupThreshold) editZone = 'warmup'
        else editZone = 'working'
        progressionStore.recalcSetXP(editSetId, xp, { theme: currentTheme.value, epoch: progressionStore.epoch, zone: editZone, isPR: editIsPR, isRepPR: editIsRepPR })
      }
    }
    closeModal()
  } else {
    let exerciseId: string = selectedExerciseId.value
    const isNew = exerciseId === '__new__'
    if (isNew) {
      const pendingTag = newExerciseTagInput.value.trim()
      if (pendingTag && !newExerciseTags.value.includes(pendingTag)) {
        newExerciseTags.value.push(pendingTag)
      }
      const newId = store.addExercise(newExerciseName.value, newExerciseTags.value)
      if (!newId) return
      exerciseId = newId
      selectedExerciseId.value = exerciseId
      if (newExercisePlateMode.value) {
        store.setExerciseInputMode(newId, 'plates')
        store.setExercisePlateCountMode(newId, newExercisePlateCountMode.value)
        const ex = store.exercises.find(e => e.id === newId)
        if (ex) ex.barWeight = newExerciseBarWeight.value
      }
      newExerciseName.value = ''
      newExerciseTags.value = []
      newExerciseSessionTags.value = []
      newExerciseTagInput.value = ''
      newExercisePlateMode.value = false
      newExercisePlateCountMode.value = 'per-side'
      newExerciseBarWeight.value = 45
      logEvent('exercise_add')
    }
    if (hasSetData.value && weight.value !== null && reps.value !== null) {
      const wasPR = isNewPR.value
      const oldE1RM = store.getExercisePR(exerciseId, prBaselineDate.value)
      const prCountBefore = wasPR ? progressionStore.totalPRCount : 0
      store.logSet(exerciseId, toLbs(weight.value), reps.value, date.value)
      logEvent('set_log', { exercise: selectedExerciseName.value, isPR: wasPR })
      const exercise = store.exercises.find(e => e.id === exerciseId)
      if (exercise && exercise.sets.length > 0) {
        const newSet = exercise.sets[exercise.sets.length - 1]
        computeAndLogXP(exerciseId, newSet.id, newSet.estimated1RM, newSet.weight, newSet.reps)
      }
      if (wasPR) {
        notifySuccess()
        const newE1RM = store.getExercisePR(exerciseId, prBaselineDate.value)
        presentPRBurst({
          exerciseName: selectedExerciseName.value,
          oldE1RM,
          newE1RM,
          setWeight: toLbs(weight.value),
          setReps: reps.value,
          isFirstPR: prCountBefore === 0,
        })
        if (prCountBefore === 0) {
          logEvent('first_pr', { exercise: selectedExerciseName.value })
        }
      } else {
        impactLight()
      }
      if (restTimerEnabled.value && restTimerAutoStart.value) {
        startRestTimer()
      }
      plateNumpadOverride.value = false
      if (plateMode.value) {
        previousPlates.value = [...currentPlates.value]
        reps.value = null
      } else {
        weight.value = null
        reps.value = null
      }
      nextTick(() => weightInputEl.value?.focus())
      emit('saved')
    } else {
      closeModal()
    }
  }
}

// ── Focus trap + swipe lifecycle ─────────────────────────────────
watch(showModal, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.logSetSheet')
    if (el) logModalFocus.activate(el)
    if (logSheetEl.value && logSheetHandleEl.value) {
      logSwipe.attach(logSheetEl.value, logSheetHandleEl.value)
    }
  } else {
    logModalFocus.deactivate()
    logSwipe.detach()
  }
})

onUnmounted(() => {
  stopTimer()
  clearTimeout(_xpPreviewTimer)
})

// ── Expose for parent ────────────────────────────────────────────
defineExpose({
  openForExercise,
  openForNew,
  openForEdit,
  openRestTimer,
  showModal,
  timerActive,
  timerDisplay,
  timerProgress,
  timerUrgent,
})
</script>
