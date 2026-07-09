<template>
  <!-- Main card -->
  <div class="wtCard">
    <!-- iOS-style large title + stats subtitle (matches screens/03-workouts.png) -->
    <header class="wtPageHeader">
      <h1 class="wtPageTitle">Workouts</h1>
      <p class="wtPageStats" v-if="store.exercises.length > 0">
        {{ totalExercises }} {{ totalExercises === 1 ? 'exercise' : 'exercises' }}
        · {{ prsThisWeek }} {{ prsThisWeek === 1 ? 'PR' : 'PRs' }} this week
      </p>
      <!-- Weekly training goal indicator (only when progression is enabled) -->
      <div v-if="weeklyGoalInfo" :class="['wtWeeklyGoal', { wtWeeklyGoalMet: weeklyGoalInfo.met, wtWeeklyGoalAtRisk: weeklyGoalInfo.atRisk }]">
        <!-- Flame icon (streak) -->
        <svg class="wtWeeklyGoalIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.5-2.5 1.5-3.5l1 1Z"/></svg>
        <span class="wtWeeklyGoalText">
          <template v-if="weeklyGoalInfo.met">Goal hit — {{ weeklyGoalInfo.trained }}/{{ weeklyGoalInfo.target }} days</template>
          <template v-else-if="weeklyGoalInfo.atRisk">Streak at risk — {{ weeklyGoalInfo.trained }}/{{ weeklyGoalInfo.target }} days</template>
          <template v-else>{{ weeklyGoalInfo.trained }}/{{ weeklyGoalInfo.target }} days this week</template>
        </span>
      </div>
      <button
        v-if="setsLoggedToday > 0"
        class="wtFinishWorkoutBtn"
        @click="openWorkoutComplete"
        aria-label="Finish workout and view today's summary"
      >
        <span class="wtFinishWorkoutLabel">Finish workout</span>
        <span class="wtFinishWorkoutMeta">
          {{ setsLoggedToday }} {{ setsLoggedToday === 1 ? 'set' : 'sets' }} today
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </header>

    <!-- View toggle (Exercises / Timeline) -->
    <div v-if="store.exercises.length > 0" class="wtViewToggle">
      <button :class="['wtViewToggleBtn', { active: listView === 'exercises' }]" @click="listView = 'exercises'">Exercises</button>
      <button :class="['wtViewToggleBtn', { active: listView === 'timeline' }]" @click="listView = 'timeline'">Timeline</button>
    </div>

    <!-- Search bar (exercises view, shown when 5+ exercises) -->
    <div v-if="listView === 'exercises' && store.exercises.length >= 5" class="wtSearchBar">
      <svg class="wtSearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input
        v-model="searchQuery"
        type="search"
        autocomplete="off"
        class="wtSearchInput"
        placeholder="Search exercises or tags…"
        aria-label="Search exercises or tags"
      />
      <span v-if="searchQuery" class="wtSearchCount">{{ filteredExercises.length }} result{{ filteredExercises.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Tag filter chips with counts (exercises view only) -->
    <template v-if="listView === 'exercises' && store.allTags.length > 0">
      <div class="wtTagFilterBar">
        <button
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.length === 0 && !searchQuery }]"
          @click="clearSearchAndTags"
          aria-label="Show all exercises"
        >All</button>
        <button
          v-for="tag in filteredTags"
          :key="tag"
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
          :aria-pressed="activeTagFilters.includes(tag)"
          @click="toggleTagFilter(tag)"
        >
          <span class="wtTagChipLabel">{{ tag }}</span>
          <span v-if="tagCounts[tag]" class="wtTagChipCount">{{ tagCounts[tag] }}</span>
        </button>
        <button
          class="wtTagChip wtTagChipManage"
          @click="openTagManager"
          aria-label="Manage tags"
        ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
      </div>
    </template>

    <div v-if="store.exercises.length === 0 && showFreshStart" class="wtFreshStart">
      <div class="wtFreshStartIcon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
      </div>
      <p class="wtFreshStartTitle">You're starting fresh!</p>
      <p class="wtFreshStartBody">Add your first exercise to begin tracking your lifts.</p>
      <button class="wtFreshStartCta" @click="openNewExerciseModal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Exercise
      </button>
    </div>
    <p v-else-if="store.exercises.length === 0" class="wtEmpty">
      No exercises yet. Tap the "+" in the top right to add your first one.
    </p>

    <template v-else-if="listView === 'exercises'">
    <p v-if="filteredExercises.length === 0 && !isFilteringActive && store.archivedExercises.length > 0" class="wtEmpty">
      All your exercises are archived. Expand "Archived" below to bring one back, or tap "+ New Exercise".
    </p>
    <p v-else-if="filteredExercises.length === 0" class="wtEmpty">
      No exercises match your search.
    </p>

    <ul v-if="filteredExercises.length > 0" class="wtExerciseList" ref="exerciseListEl">
      <li
        v-for="(exercise, index) in filteredExercises"
        :key="exercise.id"
        v-memo="[exercise.name, exercise.sets.length, exercise.sets[exercise.sets.length - 1]?.weight, exercise.sets[exercise.sets.length - 1]?.reps, exercise.tags, prBaselineDate, weightUnit, index, dragState.dragging && dragState.fromIndex === index, dragState.dragging && dragState.overIndex === index && dragState.fromIndex !== index, isFilteringActive]"
        class="wtExerciseItem"
        :class="{
          'wt-dragging': !isFilteringActive && dragState.dragging && dragState.fromIndex === index,
          'wt-drag-over': !isFilteringActive && dragState.dragging && dragState.overIndex === index && dragState.fromIndex !== index,
        }"
        :data-index="index"
        @touchstart="onItemTouchStart(index, $event)"
        @touchmove="onItemTouchMove($event)"
        @touchend="onItemTouchEnd()"
        @touchcancel="onItemTouchEnd()"
        @mousedown="onItemMouseDown(index, $event)"
        @click.capture="onItemClickCapture($event)"
      >
        <div class="wtExerciseHeader">
          <span
            :class="['wtDragHandle', { wtDragHandleDisabled: isFilteringActive }]"
            role="button"
            tabindex="0"
            :aria-label="`Reorder ${exercise.name}, position ${index + 1} of ${filteredExercises.length}`"
            :aria-disabled="isFilteringActive ? 'true' : undefined"
            @keydown="onReorderKeyDown(exercise.id, $event)"
          >⠿</span>
          <button
            class="wtExerciseRow"
            @click="openDetailModal(exercise.id)"
          >
            <div class="wtExerciseNameBlock">
              <div class="wtExerciseTopLine">
                <span class="wtExerciseName">{{ exercise.name }}</span>
                <span v-if="getRowMeta(exercise.id).isNewPRBadge" class="wtExerciseNewPR">
                  <span class="wtExerciseNewPRIcon" aria-hidden="true">🏆</span>
                  <span>NEW PR</span>
                </span>
              </div>
              <div class="wtExerciseMetaLine">
                <span
                  v-for="tag in (exercise.tags || []).slice(0, 3)"
                  :key="tag"
                  class="wtExerciseTag"
                >{{ tag }}</span>
                <span v-if="getRowMeta(exercise.id).lastSet" class="wtExerciseStat">
                  · {{ displayWeight(getRowMeta(exercise.id).lastSet!.weight) }} {{ weightUnit }}
                  × {{ getRowMeta(exercise.id).lastSet!.reps }}
                  · {{ getRowMeta(exercise.id).timeAgo }}
                </span>
                <span v-else class="wtExerciseStat wtExerciseStatEmpty">· No sets yet</span>
              </div>
            </div>
          </button>
          <button
            class="wtExerciseLogBtn wtExerciseLogBtnCircle"
            @click="openLogForExercise(exercise.id)"
            :aria-label="`Log a set for ${exercise.name}`"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </li>
    </ul>

    <!-- Archived exercises disclosure -->
    <div v-if="store.archivedExercises.length > 0 && !isFilteringActive" class="wtArchivedSection">
      <button
        class="wtArchivedToggle"
        :aria-expanded="archivedOpen"
        :aria-controls="archivedListId"
        @click="archivedOpen = !archivedOpen"
      >
        <span class="wtArchivedToggleIcon" :class="{ expanded: archivedOpen }" aria-hidden="true">›</span>
        <span class="wtArchivedToggleLabel">Archived</span>
        <span class="wtArchivedToggleCount">{{ store.archivedExercises.length }}</span>
      </button>
      <ul v-if="archivedOpen" :id="archivedListId" class="wtArchivedList">
        <li
          v-for="ex in store.archivedExercises"
          :key="ex.id"
          class="wtArchivedItem"
        >
          <button
            class="wtArchivedRow"
            @click="openDetailModal(ex.id)"
            :aria-label="`View ${ex.name} (archived)`"
          >
            <span class="wtArchivedName">{{ ex.name }}</span>
            <span class="wtArchivedMeta">{{ ex.sets.length }} {{ ex.sets.length === 1 ? 'set' : 'sets' }}</span>
          </button>
          <button
            class="wtArchivedActionBtn"
            @click="unarchiveExerciseFromList(ex.id)"
            :aria-label="`Unarchive ${ex.name}`"
          >Unarchive</button>
        </li>
      </ul>
    </div>
    </template>

    <!-- Timeline view (extracted to WorkoutTimeline.vue) -->
    <WorkoutTimeline
      v-else-if="listView === 'timeline'"
      :exercises="store.exercises"
      :pr-baseline-date="prBaselineDate"
      :warmup-threshold="_prefs.filters.warmupThreshold"
      @log-set="openTimelineLogModal"
      @edit-set="onTimelineEditSet"
      @delete-set="undoDeleteSet"
    />

  </div>

  <!-- Exercise detail modal -->
  <ExerciseDetailModal
    :exercise-id="detailExerciseId"
    @close="detailExerciseId = null"
    @open-log-set="openLogForExercise"
    @open-edit-exercise="openEditExerciseModal"
    @edit-set="openEditModal"
    @delete-set="undoDeleteSet"
  />

  <!-- Log / Edit Set Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay logSetOverlay" @click.self="onOverlayClick" @keydown.escape="closeModal">
      <div ref="logSheetEl" class="repMaxModal logSetSheet" :class="{ logSetSheetForm: !timerCtrl.timerActive.value }" :style="logSwipe.dragStyle()" @click.self="timerCtrl.editingPresets.value = false" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
        <div ref="logSheetHandleEl" class="logSetSheetHandle" aria-hidden="true"></div>

        <!-- Rest timer view -->
        <template v-if="timerCtrl.timerActive.value">
          <RestTimerContent
            :exercise-name="selectedExerciseName"
            :ctrl="timerCtrl"
            @skip-to-next="skipToNextSet"
            @dismiss="dismissTimer"
            @close="closeModal"
            @restore="showModal = true"
          />
        </template>

        <!-- Log / edit form -->
        <template v-else>
          <div class="wtModalHeader">
            <h2 id="log-modal-title">{{ modalTitle }}</h2>
            <button v-if="isLogForExercise" class="wtPlateSettingsBtn" @click="openEditExerciseModal(store.exercises.find(e => e.id === selectedExerciseId)!)" aria-label="Exercise settings">
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
                ref="dateInputEl"
                tabindex="-1"
                class="wtDateOverlayInput"
                :aria-label="'Log date, currently ' + dateDisplay"
                @click="tryShowDatePicker"
              />
            </span>
          </p>

          <!--
            Consolidated "Suggestions" drawer (#759 / #770) — one interaction
            path, not three. Folds the usual-ladder / last-session quick-fill and
            the PR-anchored Intensity table into a single segmented disclosure.
            The routine ladder (or last-session) lens is the default and stays
            expanded so the one-tap ghost-arm logging flow is preserved; the
            Intensity slider is a tap away on the segmented control. The Intensity
            lens ceils to a loadable plate increment, so its 100% end reaches
            PR-beating loads — the former separate PR table is just this table
            read at 100% (#770). Each lens reuses its existing chip/row markup.
          -->
          <div
            v-if="!isEditMode && isLogForExercise && suggestionLenses.length"
            :class="['wtPrTargets', 'wtSuggestions', { wtPrTargetsExpanded: suggestionsExpanded }]"
          >
            <button class="wtPrTargetsHeader" @click="suggestionsExpanded = !suggestionsExpanded" :aria-expanded="suggestionsExpanded">
              <span class="wtPrTargetsTitleCol">
                <span class="wtPrTargetsTitle">Suggestions</span>
                <span class="wtPrTargetsSub">{{ suggestionHeaderSub }}</span>
              </span>
              <svg :class="['wtPrTargetsChevron', { wtPrTargetsChevronOpen: suggestionsExpanded }]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            <div v-if="suggestionsExpanded" class="wtSuggestionBody">
              <div v-if="suggestionLenses.length > 1" class="wtSuggestionSegments" role="tablist" aria-label="Suggestion type">
                <button
                  v-for="lens in suggestionLenses"
                  :key="lens"
                  type="button"
                  role="tab"
                  :aria-selected="currentLens === lens"
                  :class="['wtSuggestionSegment', { wtSuggestionSegmentActive: currentLens === lens }]"
                  @click="activeLens = lens"
                >{{ lensLabel(lens) }}</button>
              </div>

              <!-- Routine: usual-ladder rungs (quick-fill + ghost-arm) -->
              <template v-if="currentLens === 'routine' && usualLadder">
                <span class="wtPrevSessionLabel">{{ ladderLabel }}</span>
                <div ref="ladderChipsEl" class="wtPrevSessionChips">
                  <button
                    v-for="(rung, i) in usualLadder.rungs"
                    :key="i"
                    class="wtPrevSessionChip"
                    :class="{
                      wtPrevSessionChipUsed: rungStates[i] === 'done',
                      wtPrevSessionChipNext: rungStates[i] === 'next',
                      wtPrevSessionChipSkipped: rungStates[i] === 'skipped',
                    }"
                    :aria-current="rungStates[i] === 'next' ? 'step' : undefined"
                    :aria-label="rungStates[i] === 'done' ? `${displayWeight(rung.weightLbs)} × ${rung.reps}, logged`
                      : rungStates[i] === 'skipped' ? `${displayWeight(rung.weightLbs)} × ${rung.reps}, skipped` : undefined"
                    @click="fillFromRung(rung)"
                  >{{ displayWeight(rung.weightLbs) }} × {{ rung.reps }}</button>
                </div>
              </template>

              <!-- Last session quick-fill (fallback when no routine is detected) -->
              <template v-else-if="currentLens === 'last' && lastSession">
                <span class="wtPrevSessionLabel">Last session · {{ formatShortDate(lastSession.date + 'T12:00:00') }}</span>
                <div class="wtPrevSessionChips">
                  <button
                    v-for="(s, i) in lastSession.sets"
                    :key="i"
                    class="wtPrevSessionChip"
                    :class="{ wtPrevSessionChipUsed: lastSessionUsed[i] }"
                    @click="fillFromLastSession(s, i)"
                  >{{ displayWeight(s.weight) }} × {{ s.reps }}</button>
                </div>
              </template>

              <!-- Intensity: PR-anchored weight × reps at the chosen % of max.
                   Ceiling rounding means the 100% end reaches PR-beating loads,
                   so this one lens spans warmups → PR (#770). -->
              <template v-else-if="currentLens === 'intensity'">
                <span class="wtPrevSessionLabel">{{ intensityPct }}% of {{ displayWeight(intensityOneRM!) }} {{ weightUnit }} max</span>
                <!-- Tappable presets (configured in Settings, #776) — the fast path;
                     the slider below stays for one-off intensities. -->
                <div v-if="intensityPresets.length" class="wtPrevSessionChips wtIntensityPresetChips" role="group" aria-label="Intensity presets">
                  <button
                    v-for="p in intensityPresets"
                    :key="p"
                    type="button"
                    class="wtPrevSessionChip"
                    :class="{ wtPrevSessionChipNext: intensityPct === p }"
                    :aria-pressed="intensityPct === p"
                    @click="intensityPct = p"
                  >{{ p }}%</button>
                </div>
                <div class="wtIntensityControl">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    :step="INTENSITY_STEP"
                    v-model.number="intensityPct"
                    class="wtIntensitySlider"
                    :aria-label="`Intensity, ${intensityPct} percent of max`"
                  />
                  <span class="wtIntensityValue">{{ intensityPct }}%</span>
                </div>
                <div v-if="intensityTable.length" class="wtPrTargetsList wtSuggestionList">
                  <button
                    v-for="(row, i) in intensityTable"
                    :key="row.reps"
                    :class="['wtPrTargetsRow', { wtPrTargetsRowActive: intensityUsed[i] }]"
                    :aria-label="`${displayWeight(row.weightLbs)} ${weightUnit} for ${row.reps} reps, ${displayWeight(row.e1rm)} ${weightUnit} estimated 1RM`"
                    @click="fillFromIntensity(row, i)"
                  >
                    <span class="wtPrTargetsReps">{{ row.reps }}</span>
                    <span class="wtPrTargetsRepsLabel">{{ row.reps === 1 ? 'rep' : 'reps' }}</span>
                    <span class="wtPrTargetsWeight">{{ displayWeight(row.weightLbs) }} {{ weightUnit }}</span>
                    <span class="wtPrTargetsE1rm">~{{ displayWeight(row.e1rm) }} {{ weightUnit }} e1RM</span>
                  </button>
                </div>
                <p v-else class="wtIntensityEmpty">Nothing loadable at {{ intensityPct }}% — slide higher.</p>
              </template>
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
          <div
            v-else-if="overloadNudge"
            class="repMaxResult repMaxResultTarget repMaxResultTappable wtOverloadCard"
            role="button"
            tabindex="0"
            :aria-label="`Load suggested set, ${overloadNudge.displayWeight} ${weightUnit} × ${overloadNudge.reps}`"
            @click="acceptOverloadNudge"
            @keydown.enter="acceptOverloadNudge"
          >
            <span class="repMaxResultLabel">Suggestion</span>
            <span class="repMaxResultValue">{{ overloadNudge.displayWeight }} {{ weightUnit }} × {{ overloadNudge.reps }}</span>
            <span class="repMaxPersonalBest">Up from {{ displayWeight(overloadNudge.fromWeightLbs) }} {{ weightUnit }} × {{ overloadNudge.fromReps }} · Tap to load</span>
          </div>
          <div v-else-if="!isEditMode && isLogForExercise" class="repMaxResult repMaxResultPlaceholder">
            <span class="repMaxResultLabel">Estimated 1RM</span>
            <span class="repMaxResultPlaceholderText">Enter weight and reps to see estimate</span>
          </div>

          <!--
            Primary WEIGHT + REPS cards per screens/05-logset-platecalc.png.
            Layout: two cards side-by-side, weight (~60%) on the left with a
            big 44px number and the unit suffix, reps (~40%) on the right
            with the value stacked above a [−][+] stepper.

            Shown in BOTH numpad and plate modes — in plate mode the WEIGHT
            input displays the live-computed total from the plates picker
            below, and typing into it switches to manual override (the
            existing `syncPlatesFromWeight` watcher reverse-syncs plates).
            The standalone reps stepper that used to render in plate mode
            is gone — the REPS card here covers the same job and avoids
            the parallel input that gemini-3.1-pro flagged as a P1
            (the v-else previously hid this row entirely in plate mode,
            which after step 5c removed the in-card weight display would
            leave the user with no visible weight at all).
          -->
          <div class="wtInputRow logSetFieldsRow">
            <label :class="['repMaxLabel', 'logSetField', 'logSetFieldWeight', { logSetFieldActive: weightHasValue }]">
              <span class="logSetFieldLabel">Weight <span class="logSetFieldLabelUnit">({{ weightUnit }})</span></span>
              <div class="logSetFieldValueRow">
                <input
                  ref="weightInputEl"
                  v-model="weightStr"
                  type="text"
                  inputmode="decimal"
                  enterkeyhint="next"
                  autocomplete="off"
                  :placeholder="ghostArmed && nextRung ? String(displayWeight(nextRung.weightLbs)) : '135'"
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
                enterkeyhint="done"
                autocomplete="off"
                :placeholder="ghostArmed && nextRung ? String(nextRung.reps) : '—'"
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

          <!--
            Plate calculator (shown when exercise is in plates mode).
            Matches screens/05-logset-platecalc.png:
            - Bordered card with header row: "PER SIDE · 45 LB BAR" + delta vs last
            - 5-column grid: gold +N pill on top, count, dim −N pill on bottom
            The weight value itself is rendered by the WEIGHT card above; this
            card is purely the plate-picker chrome.
          -->
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
              {{ isEditMode ? 'Save Changes' : (selectedExerciseId === '__new__' && !hasSetData ? 'Add Exercise' : (ghostArmed && nextRung ? `Save ${displayWeight(nextRung.weightLbs)} × ${nextRung.reps}` : 'Save')) }}
            </button>
            <button class="repMaxBtn repMaxBtnClose" @click="closeModal">{{ isEditMode ? 'Cancel' : 'Done' }}</button>
          </div>

        </template>
      </div>
    </div>
  </Teleport>


  <!-- Edit Exercise Modal (extracted to EditExerciseModal.vue) -->
  <EditExerciseModal
    :exercise="editTargetExercise"
    :all-tags="store.allTags"
    @close="editTarget = null"
    @save="onEditExerciseSave"
    @archive="handleArchiveFromEdit"
    @unarchive="handleUnarchiveFromEdit"
    @delete="onEditExerciseDelete"
  />

  <!-- Exercise Picker (timeline + Log Set; extracted to ExercisePickerModal.vue) -->
  <ExercisePickerModal
    :open="timelineLogPicking"
    :exercises="store.activeExercises"
    @close="timelineLogPicking = false"
    @select="pickExerciseForLog"
    @create-new="pickNewExerciseFromPicker"
  />

  <!-- Tag Manager Modal (extracted to TagManagerModal.vue) -->
  <TagManagerModal
    :open="tagManagerOpen"
    :all-tags="store.allTags"
    :exercises="store.exercises"
    @close="tagManagerOpen = false"
    @create-tag="store.addCustomTag"
    @rename-tag="onRenameTag"
    @delete-tag="confirmDeleteTag"
    @toggle-exercise-tag="toggleExerciseTag"
  />

  <!-- Rest timer bar -->
  <button
    v-if="restTimerEnabled && !showModal"
    class="wtRestBar"
    :class="{ wtRestBarActive: timerCtrl.timerActive.value && !showModal, wtRestBarUrgent: timerCtrl.timerUrgent.value && timerCtrl.timerActive.value && !showModal }"
    @click="openRestTimer"
  >
    <template v-if="timerCtrl.timerActive.value">
      <div class="wtRestBarProgress" :style="{ width: (timerCtrl.timerProgress.value * 100) + '%' }"></div>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarTime">{{ timerCtrl.timerDisplay.value }}</span>
      <span class="wtRestBarLabel">remaining</span>
    </template>
    <template v-else>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarLabel">Start Rest Timer</span>
    </template>
  </button>

  <Teleport to="body">
    <WorkoutCompleteView
      v-if="workoutCompleteSummary"
      :summary="workoutCompleteSummary"
      @close="workoutCompleteDate = null"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { buildSessionSummary } from '../lib/sessionSummary'
import { todayISO, setDayKey, formatShortDate, daysBetweenISO } from '../lib/dates'

const WorkoutCompleteView = defineAsyncComponent(() => import('./WorkoutCompleteView.vue'))
import type { Exercise, WorkoutSet, PlateCountMode, UsualLadder, UsualLadderRung } from '../stores/workout'

import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'
import { useWeightUnit } from '../composables/useWeightUnit'
import { useRestTimer } from '../composables/useRestTimer'
import { useRestTimerController } from '../composables/useRestTimerController'
import { useUndoToast } from '../composables/useUndoToast'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import { useFocusTrap } from '../composables/useFocusTrap'
import { useLongPressReorder } from '../composables/useLongPressReorder'
import { useHaptics } from '../composables/useHaptics'
import { usePRBaseline } from '../composables/usePRBaseline'
import { usePRBurst } from '../composables/usePRBurst'
import { useGoalCelebration } from '../composables/useGoalCelebration'
import { decideGoalCelebration, readGoalCelebrationState, markGoalWeekCelebrated } from '../lib/goalCelebration'
import { useProgressionStore } from '../stores/progression'
import { platesToWeight, weightToPlates, LBS_PLATES, KG_PLATES } from '../lib/plateCalculator'
import { generateIntensityTable, DEFAULT_INTENSITY_MAX_REPS, type IntensityRow } from '../lib/intensityTable'
import { applyStreakMultiplier, isExerciseEstablished, XP_CONFIG } from '../lib/xp'
import { scoreSet } from '../lib/setScoring'
import { useXPCeremony } from '../composables/useXPCeremony'
import { computeWeeklyGoal } from '../lib/weeklyGoal'
import ExerciseDetailModal from '../views/ExerciseDetailModal.vue'
import RestTimerContent from './RestTimerContent.vue'
import WorkoutTimeline from './WorkoutTimeline.vue'
import EditExerciseModal, { type EditExerciseSave } from './EditExerciseModal.vue'
import TagManagerModal from './TagManagerModal.vue'
import ExercisePickerModal from './ExercisePickerModal.vue'
import { scrollInputAboveKeyboard } from '../lib/keyboardViewport'
import { ladderChipScrollLeft } from '../lib/ladderScroll'
import { MAX_WEIGHT, MAX_REPS } from '../lib/inputLimits'
import { loadJSON } from '../lib/storage'

const store = useWorkoutStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { currentTheme } = useTheme()
const { restTimerEnabled, restTimerAutoStart } = useRestTimer()
const { weightUnit, displayWeight, toLbs } = useWeightUnit()
const { impactLight, notifySuccess } = useHaptics()
const { logSetXPCeremony } = useXPCeremony()
const { prBaselineDate } = usePRBaseline()
const { presentPRBurst } = usePRBurst()
const { presentGoalCelebration } = useGoalCelebration()

// Rest timer controller — all timer state and logic extracted into composable
const timerCtrl = useRestTimerController(
  () => { skipToNextSet() },
  showUndo,
)

// Screen Wake Lock — keep display on during active workouts
import { useWakeLock } from '../composables/useWakeLock'
import { usePreferencesStore } from '../stores/preferences'
const _prefs = usePreferencesStore()
const wakeLockEnabled = computed(() => _prefs.experience.screenWakeLock !== false)

function computeAndLogXP(exerciseId: string, setId: string, estimated1RM: number, weight: number, reps: number) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (!exercise) return

  // Score against existing sets (the just-logged set is already in the array).
  const otherSets = exercise.sets.filter(s => s.id !== setId)
  const { best1RM, isPR, isTie, isRepPR, zone, baseXP } = scoreSet({
    priorSets: otherSets,
    estimated1RM,
    weightLbs: weight,
    reps,
    dateKey: date.value || todayISO(),
    baseline: prBaselineDate.value,
  })

  const mult = progressionStore.currentMultiplier
  let xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, new Date().toISOString())
  // If no history entry for current week, apply currentMultiplier directly
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

// ── Fresh-start transition card ─────────────────────────────────
// Shown after user clears sample data, dismissed on first exercise add
const showFreshStart = ref(localStorage.getItem('fresh-start') === 'true')
function onFreshStart() { showFreshStart.value = true }
onMounted(() => { window.addEventListener('fresh-start', onFreshStart) })
onUnmounted(() => { window.removeEventListener('fresh-start', onFreshStart) })
watch(() => store.exercises.length, (len) => {
  if (len > 0 && showFreshStart.value) {
    localStorage.removeItem('fresh-start')
    showFreshStart.value = false
  }
})

// ── View toggle ──────────────────────────────────────────────────
const listView = ref<'exercises' | 'timeline'>(
  (localStorage.getItem('wt-list-view') as 'exercises' | 'timeline') || 'exercises'
)
watch(listView, v => localStorage.setItem('wt-list-view', v))

// ── Timeline view (extracted to WorkoutTimeline.vue) ────────────
/** Timeline rows carry only the exercise id — resolve it before opening the edit modal. */
function onTimelineEditSet(exerciseId: string, set: WorkoutSet) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (exercise) openEditModal(exercise, set)
}

// ── Search & tag filtering ──────────────────────────────────────
const searchQuery = ref('')
const activeTagFilters = ref<string[]>([])

/**
 * Tag chips visible in the filter row. When the user is searching we narrow
 * the row to tags that match the query (so typing "shoulders" also filters
 * the chips), plus any currently-active tag so the user can see + toggle it
 * back off without clearing the search first.
 */
const filteredTags = computed<string[]>(() => {
  // Only surface tags that exist on at least one active (non-archived)
  // exercise. Otherwise tapping a chip filters to an empty list because the
  // archived section is hidden whenever a filter is active.
  const activeTags = store.allTags.filter(t => (tagCounts.value[t] || 0) > 0)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return activeTags
  return activeTags.filter(t =>
    t.toLowerCase().includes(q) || activeTagFilters.value.includes(t)
  )
})

function toggleTagFilter(tag: string) {
  // Tapping a tag chip commits the user's intent: clear the search and apply
  // the tag as a filter. If the tag was already active, tapping deactivates it.
  const wasActive = activeTagFilters.value.includes(tag)
  searchQuery.value = ''
  if (wasActive) {
    activeTagFilters.value = activeTagFilters.value.filter(t => t !== tag)
  } else {
    activeTagFilters.value = [...activeTagFilters.value, tag]
  }
}

/** "All" chip — clear both the search and any active tags. */
function clearSearchAndTags() {
  searchQuery.value = ''
  activeTagFilters.value = []
}

const filteredExercises = computed(() => {
  let result = store.activeExercises
  // Text search — check both name and tags so "Push" matches tag-filtered rows.
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    result = result.filter(e => {
      if (e.name.toLowerCase().includes(q)) return true
      const tags = e.tags || []
      return tags.some(t => t.toLowerCase().includes(q))
    })
  }
  // Tag filter
  if (activeTagFilters.value.length > 0) {
    result = result.filter(e => {
      const tags = e.tags || []
      return activeTagFilters.value.some(t => tags.includes(t))
    })
  }
  return result
})

/**
 * True when the list is showing a filtered subset of exercises (either a
 * text search query or one-or-more active tag filters). Long-press
 * reorder is disabled in this state because `v-for` gives us indices
 * into the filtered subset, and those indices are meaningless to the
 * store, which splices the unfiltered `exercises` array. Dropping a
 * filtered-index 0 row would move the absolute-index 0 row — usually
 * a completely different exercise the user can't even see.
 *
 * Fixes: reordering while searching silently scrambled unrelated rows
 * (previously only the tag-filter path was gated).
 */
const isFilteringActive = computed(() =>
  activeTagFilters.value.length > 0 || searchQuery.value.trim() !== ''
)

/** Total exercise count, shown in the "Workouts" header stats. */
const totalExercises = computed(() => store.activeExercises.length)

/** Sets logged on the local "today" date — drives the Finish workout affordance. */
const setsLoggedToday = computed(() => {
  const today = todayISO()
  let count = 0
  for (const ex of store.exercises) {
    for (const s of ex.sets) {
      if (setDayKey(s.date) === today) count++
    }
  }
  return count
})

/** When non-null, renders the WorkoutCompleteView overlay for that date. */
const workoutCompleteDate = ref<string | null>(null)
const workoutCompleteSummary = computed(() => {
  const d = workoutCompleteDate.value
  if (!d) return null
  return buildSessionSummary({
    rawDate: d,
    exercises: store.exercises,
    xpPerSet: progressionStore.xpPerSet,
    streakWeeks: progressionStore.streakWeeks,
    toDisplayUnits: displayWeight,
    unitLabel: weightUnit.value,
  })
})
function openWorkoutComplete() {
  workoutCompleteDate.value = todayISO()
  impactLight()
  logEvent('workout_complete_view_opened', { sets: setsLoggedToday.value })
}

/** Exercises whose baseline-relative PR was achieved in the last 7 days. */
const prsThisWeek = computed(() => {
  const now = Date.now()
  const weekAgo = now - 7 * 86400000
  let count = 0
  for (const e of store.exercises) {
    const pr = store.getExercisePRSet(e.id, prBaselineDate.value)
    if (pr && new Date(pr.date).getTime() >= weekAgo) count++
  }
  return count
})

/**
 * Weekly goal indicator — counts unique training days in the current Mon–Sun week
 * and compares against the user's weeklyTarget from the progression store.
 * Returns null when progression is disabled (indicator hidden).
 */
const weeklyGoalInfo = computed(() => {
  if (!progressionStore.progressionEnabled) return null
  return computeWeeklyGoal(store.exercises, progressionStore.weeklyTarget)
})

/**
 * Fire the weekly-goal celebration the first time the goal is met each week
 * (LIFT-764). Called after a set is logged. Skipped while a PR burst is showing
 * so the two overlays never stack — the week is left unmarked so the
 * celebration still fires on the next non-PR set. The once-per-week guard lives
 * in device-local storage, mirroring the overload nudge.
 *
 * Returns `true` when a celebration (and its success/milestone haptic) actually
 * fired, so the caller can suppress the routine light tap and avoid two native
 * haptics colliding into a muddy buzz on Capacitor/iOS.
 */
function maybeCelebrateWeeklyGoal(prShown: boolean): boolean {
  if (prShown) return false
  const info = weeklyGoalInfo.value
  if (!info) return false
  const state = readGoalCelebrationState()
  const decision = decideGoalCelebration(info.met, progressionStore.streakWeeks, state.lastCelebratedWeek)
  if (!decision) return false
  markGoalWeekCelebrated(decision.weekKey)
  const celebrated = presentGoalCelebration({ streak: decision.streak, milestone: decision.milestone, target: info.target })
  logEvent('weekly_goal_celebrated', { streak: decision.streak, milestone: decision.milestone })
  // A streak-tier crossing (2/4/8/12-week multiplier bump) is a distinct
  // progression-depth signal from simply hitting the weekly goal — emit a
  // dedicated event so streak retention is filterable in the dashboard (#796).
  if (decision.milestone) {
    logEvent('streak_milestone', { streak: decision.streak, target: info.target })
  }
  return celebrated
}

/**
 * Count of exercises carrying each tag — powers the "Push 23" suffix on tag
 * chips. Counts only active (non-archived) exercises so that the chip count
 * matches what the tag filter will actually show. Tags that exist solely on
 * archived exercises are filtered out by `filteredTags` below.
 */
const tagCounts = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  for (const e of store.activeExercises) {
    for (const t of e.tags || []) {
      map[t] = (map[t] || 0) + 1
    }
  }
  return map
})

/**
 * Per-row presentation data for the main exercise list: last set summary,
 * time-ago, and whether the current baseline-relative PR was set this week
 * (drives the "NEW PR" gold badge in the card).
 */
interface ExerciseRowMeta {
  lastSet: { weight: number; reps: number; date: string } | null
  timeAgo: string | null
  isNewPRBadge: boolean
}

function getRowMeta(exerciseId: string): ExerciseRowMeta {
  const ex = store.exercises.find(e => e.id === exerciseId)
  if (!ex || ex.sets.length === 0) return { lastSet: null, timeAgo: null, isNewPRBadge: false }
  const last = ex.sets[ex.sets.length - 1]
  const prSet = store.getExercisePRSet(exerciseId, prBaselineDate.value)
  const isFreshPR = !!prSet && (Date.now() - new Date(prSet.date).getTime()) < 7 * 86400000
  return {
    lastSet: { weight: last.weight, reps: last.reps, date: last.date },
    timeAgo: formatTimeAgo(last.date),
    isNewPRBadge: isFreshPR,
  }
}

// Remove stale tags from active filters
watch(() => store.allTags, (tags) => {
  activeTagFilters.value = activeTagFilters.value.filter(t => tags.includes(t))
})

// ── Exercise detail modal (extracted to ExerciseDetailModal.vue) ──
const detailExerciseId = ref<string | null>(null)

const logModalFocus = useFocusTrap()

// ── Swipe-to-dismiss for log-set sheet (step 5f) ────────────────
// Drag the handle (or the sheet body, when not scrolled) down past
// 100px to close the sheet. Uses the same composable as the detail
// modal so the gesture feels consistent across the app.
const logSheetEl = ref<HTMLElement | null>(null)
const logSheetHandleEl = ref<HTMLElement | null>(null)
const logSwipe = useSwipeToDismiss({
  threshold: 100,
  onDismiss: () => closeModal(),
})

function openDetailModal(id: string) {
  detailExerciseId.value = id
}

// ── Long-press to reorder (gesture in useLongPressReorder) ──────
const exerciseListEl = ref<HTMLElement | null>(null)

const {
  dragState,
  onItemTouchStart,
  onItemTouchMove,
  onItemTouchEnd,
  onItemMouseDown,
  onItemClickCapture,
} = useLongPressReorder({
  listEl: exerciseListEl,
  itemSelector: '.wtExerciseItem',
  // Never start a drag when pressing the "+ Log" affordance.
  ignoreSelector: '.wtExerciseLogBtn',
  // Block reorder whenever the list is filtered (tag filter OR search).
  // Template indices are into the filtered subset, but the store splices
  // the unfiltered array — a drop under a filter corrupts unrelated rows.
  disabled: () => isFilteringActive.value,
  // Haptic confirms pickup — Capacitor Haptics on native, Vibration API on web.
  onPickup: () => impactLight(),
  onReorder: (fromIndex, toIndex) => {
    // Drag indices are positions in `filteredExercises` (active-only),
    // but `store.reorderExercise` operates on the full `exercises` array.
    // Map via exercise IDs so archived rows preserve their relative position
    // and don't get accidentally reordered.
    const fromEx = filteredExercises.value[fromIndex]
    const toEx = filteredExercises.value[toIndex]
    if (!fromEx || !toEx) return
    const fromStoreIdx = store.exercises.findIndex(e => e.id === fromEx.id)
    const toStoreIdx = store.exercises.findIndex(e => e.id === toEx.id)
    if (fromStoreIdx === -1 || toStoreIdx === -1) return
    store.reorderExercise(fromStoreIdx, toStoreIdx)
    logEvent('exercise_reorder')
  },
})

function onReorderKeyDown(exerciseId: string, event: KeyboardEvent) {
  if (isFilteringActive.value) return
  const key = event.key
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return
  event.preventDefault()

  // Compute index dynamically from the current filtered list to avoid stale
  // template indices when the user holds a key and events fire rapidly.
  const filtered = filteredExercises.value
  const index = filtered.findIndex(e => e.id === exerciseId)
  if (index === -1) return

  const newIndex = key === 'ArrowUp' ? index - 1 : index + 1
  if (newIndex < 0 || newIndex >= filtered.length) return

  const fromEx = filtered[index]
  const toEx = filtered[newIndex]
  if (!fromEx || !toEx) return

  const fromStoreIdx = store.exercises.findIndex(e => e.id === fromEx.id)
  const toStoreIdx = store.exercises.findIndex(e => e.id === toEx.id)
  if (fromStoreIdx === -1 || toStoreIdx === -1) return

  store.reorderExercise(fromStoreIdx, toStoreIdx)
  impactLight()
  logEvent('exercise_reorder')

  // After Vue re-renders, focus the drag handle at the item's new position
  nextTick(() => {
    const list = exerciseListEl.value
    if (!list) return
    const items = list.querySelectorAll('.wtExerciseItem')
    const handle = items[newIndex]?.querySelector<HTMLElement>('.wtDragHandle')
    handle?.focus()
  })
}

/** Relative time string used on the main exercise list ("today", "yesterday", "4 days ago"). */
function formatTimeAgo(iso: string): string {
  const now = new Date()
  const then = new Date(iso)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const days = Math.round((startOfToday - startOfThen) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return formatShortDate(iso)
}

// ── Log / Edit modal state ────────────────────────────────────────
const weightInputEl = ref<HTMLInputElement | null>(null)
const showModal = ref(false)

const editingSet = ref<{ exerciseId: string; setId: string } | null>(null)
const selectedExerciseId = ref('')

// ── Last session for quick-fill ──────────────────────────────────
const lastSession = computed(() => {
  return store.getLastSession(selectedExerciseId.value, todayISO())
})

// Track which last-session sets the user has already tapped (visual feedback)
const lastSessionUsed = ref<Record<number, boolean>>({})

function fillFromLastSession(set: { weight: number; reps: number }, index: number) {
  weightStr.value = String(displayWeight(set.weight))
  repsStr.value = String(set.reps)
  lastSessionUsed.value = { ...lastSessionUsed.value, [index]: true }
}

// ── Intensity lens: PR/1RM-anchored weight × reps table (#770) ─────
// A slider picks an intensity (% of the exercise's best e1RM); the table shows,
// per rep count, the lightest LOADABLE weight whose e1RM MEETS OR BEATS that
// intensity (ceiled to a plate increment). Ceiling is what lets one lens span
// warmups (low %) through PR-beating loads (100%) — the former separate "PR"
// table is just this table read at 100%. Reps are NOT prescribed — the user
// taps the row matching their planned reps; each row carries its e1RM.
const INTENSITY_DEFAULT_PCT = 80
const INTENSITY_STEP = 5
const intensityPct = ref(INTENSITY_DEFAULT_PCT)
const intensityUsed = ref<Record<number, boolean>>({})

// `intensityUsed` is keyed by row index; moving the slider rebuilds the table
// with new weights at the same indices, so a stale "used" highlight would lie.
// Clear it whenever the intensity changes.
watch(intensityPct, () => { intensityUsed.value = {} })

// Anchor: the exercise's best e1RM (its PR) — same source as the PR lens.
const intensityOneRM = computed<number | null>(() => {
  if (isEditMode.value || !isLogForExercise.value) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  return pr > 0 ? pr : null
})

const intensityMaxReps = computed<number>(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  return ex?.intensityMaxReps ?? DEFAULT_INTENSITY_MAX_REPS
})

// Global, user-configured intensity presets (Settings → Intensity Presets, #776).
// Rendered as tappable chips above the slider; tapping one sets intensityPct.
const intensityPresets = computed<number[]>(() => _prefs.intensityPresets)

const intensityTable = computed<IntensityRow[]>(() => {
  const oneRM = intensityOneRM.value
  if (oneRM === null) return []
  return generateIntensityTable(oneRM, intensityPct.value, {
    barWeight: currentBarWeight.value,
    perSide: isPerSide.value,
    denominations: weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES,
    maxReps: intensityMaxReps.value,
    plateMode: plateMode.value,
    unit: weightUnit.value,
  })
})

// ── Consolidated "Suggestions" drawer (#759 / #770) ───────────────
// One segmented disclosure over every "what should my next set be?" lens —
// routine ladder / last-session quick-fill and the PR-anchored intensity table
// (which spans warmups → PR-beating at 100%) — instead of stacked cards.
// `suggestionLenses` (defined after the lenses' source computeds) lists what's
// available; `currentLens` self-heals if the selected lens loses its data. The
// drawer opens expanded on the quick-fill lens (routine/last) so the one-tap
// ghost-arm flow is never a tap away.
type SuggestionLens = 'routine' | 'last' | 'intensity'
const suggestionsExpanded = ref(false)
const activeLens = ref<SuggestionLens>('routine')

/** Load an intensity row into the inputs (mirrors fillFromRung's plate handling). */
function fillFromIntensity(row: IntensityRow, index: number) {
  if (plateMode.value && row.plates) {
    currentPlates.value = [...row.plates]
    syncPlateWeight()
  } else {
    weightStr.value = String(displayWeight(row.weightLbs))
  }
  repsStr.value = String(row.reps)
  intensityUsed.value = { ...intensityUsed.value, [index]: true }
  impactLight()
}

// ── Usual ladder: routine-aware quick-fill + ghost logging (#741) ──
// Captured once per modal open so the ladder never reshuffles mid-session
// (detection excludes today, so re-opening between sets yields the same rungs).
const usualLadder = ref<UsualLadder | null>(null)

// Mirrors the store's clustering tolerance — absorbs kg↔lbs float drift.
const LADDER_MATCH_TOLERANCE = 1.0

const ladderActive = computed(() =>
  usualLadder.value !== null &&
  !isEditMode.value &&
  isLogForExercise.value &&
  date.value === todayISO()
)

type RungState = 'done' | 'next' | 'skipped' | 'upcoming'

// Doneness is derived entirely from today's logged sets in the store — it
// survives modal close/reopen, set edits, and deletes with zero local state.
const rungStates = computed<RungState[]>(() => {
  if (!ladderActive.value) return []
  const rungs = usualLadder.value!.rungs
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  const today = todayISO()
  const todaySets = ex ? ex.sets.filter(s => setDayKey(s.date) === today) : []

  // Each today-set consumes the first pending rung within tolerance.
  const done = rungs.map(() => false)
  let maxTodayWeight = -Infinity
  for (const s of todaySets) {
    if (s.weight > maxTodayWeight) maxTodayWeight = s.weight
    for (let i = 0; i < rungs.length; i++) {
      if (!done[i] && Math.abs(rungs[i].weightLbs - s.weight) <= LADDER_MATCH_TOLERANCE) {
        done[i] = true
        break
      }
    }
  }
  // Beating the top rung (e.g. accepting the overload nudge) also completes it.
  const lastIdx = rungs.length - 1
  if (!done[lastIdx] && todaySets.some(s => s.weight >= rungs[lastIdx].weightLbs - LADDER_MATCH_TOLERANCE)) {
    done[lastIdx] = true
  }
  // Pending rungs lighter than today's heaviest are moot warm-ups → skipped.
  // Strict inequality keeps remaining repeat top-set rungs (e.g. 2nd of 3×225) pending.
  const states: RungState[] = rungs.map((rung, i) =>
    done[i] ? 'done'
      : todaySets.length > 0 && rung.weightLbs < maxTodayWeight - LADDER_MATCH_TOLERANCE ? 'skipped'
      : 'upcoming'
  )
  const nextIdx = states.indexOf('upcoming')
  if (nextIdx !== -1) states[nextIdx] = 'next'
  return states
})

const nextRungIndex = computed(() => rungStates.value.indexOf('next'))
const nextRung = computed<UsualLadderRung | null>(() => {
  const i = nextRungIndex.value
  return i >= 0 ? usualLadder.value!.rungs[i] : null
})

const ladderDoneCount = computed(() =>
  rungStates.value.filter(s => s === 'done' || s === 'skipped').length
)

const ladderLabel = computed(() => {
  if (!usualLadder.value) return ''
  const total = usualLadder.value.rungs.length
  return ladderDoneCount.value === 0
    ? `Usual · ${total} sets`
    : `Usual · ${ladderDoneCount.value} of ${total}`
})

function fillFromRung(rung: UsualLadderRung) {
  if (plateMode.value) {
    const plates = weightToPlates(rung.weightLbs, currentBarWeight.value, weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES)
    if (plates) {
      currentPlates.value = plates
      syncPlateWeight()
    }
  } else {
    weightStr.value = String(displayWeight(rung.weightLbs))
  }
  repsStr.value = String(rung.reps)
  impactLight()
}

// Ghost prefill: with both fields empty the next rung shows as input
// placeholders and Save commits it directly — one tap per habitual set.
// Typing anything disarms it. Fields stay genuinely empty, so the settled
// "fields cleared after save" pattern holds.
//
// Two extra disarm conditions guard the tap-tap-tap flow:
// - ghostJustSaved: brief cooldown after a ghost save so an iOS double-tap
//   can't silently log two rungs (the settled pattern's implicit guard —
//   fields cleared → Save disabled — doesn't exist on the ghost path).
// - overloadNudge visible: the nudge offers a heavier payload than the armed
//   rung; presenting both would put two near-identical numbers with opposite
//   tap semantics side by side. Save disarms until the user chooses (tap the
//   nudge card, tap a chip, or type).
const ghostJustSaved = ref(false)
let _ghostRearmTimer: ReturnType<typeof setTimeout> | null = null
const GHOST_REARM_MS = 500

const ghostArmed = computed(() =>
  ladderActive.value &&
  nextRung.value !== null &&
  weightStr.value === '' &&
  repsStr.value === '' &&
  !plateMode.value &&
  !ghostJustSaved.value &&
  overloadNudge.value === null
)

// Keep the highlighted "next" chip visible as the user works up the ladder.
// HORIZONTAL ONLY: scrollIntoView() would scroll every ancestor, including the
// vertical modal — yanking the inputs (and the just-saved confirmation) off
// screen after each save (#780). We scroll the chip row by itself instead.
const ladderChipsEl = ref<HTMLElement | null>(null)
watch(nextRungIndex, async (idx) => {
  if (idx < 0 || !showModal.value) return
  await nextTick()
  const container = ladderChipsEl.value
  const el = container?.querySelector<HTMLElement>('.wtPrevSessionChipNext')
  if (!container || !el) return
  const delta = ladderChipScrollLeft(
    container.getBoundingClientRect(),
    el.getBoundingClientRect(),
  )
  if (delta === 0) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  container.scrollBy({ left: delta, behavior: reduced ? 'auto' : 'smooth' })
})

// ── Overload nudge: rate-limited "go heavier" suggestion (#741) ───
// Surfaces only at the natural decision point — the habitual top set is up
// next — and only for high-confidence suggestions. Device-local UX state
// (PLATE_HINT_KEY precedent): deliberately NOT in preferences (would enter
// the Supabase sync payload) and NOT on Exercise (would trip LWW merge).
const NUDGE_STORAGE_KEY = 'overload-nudge-state'
// Suggested weight sits one store increment (5 lbs) above the habitual top set.
const NUDGE_WEIGHT_INCREMENT = 5
const NUDGE_BREAK_DAYS = 21
// Cooldown ladder indexed by ignoredCount; ≥3 ignores mutes the exercise
// until its habitual top weight actually changes (the silent escape hatch).
const NUDGE_COOLDOWNS = [7, 14, 28]

interface NudgeExerciseState {
  lastShownDay: string
  shownForWeightLbs: number
  outcome: 'pending' | 'accepted' | 'ignored'
  ignoredCount: number
}
interface NudgeState {
  lastGlobalShownDay: string
  byExercise: Record<string, NudgeExerciseState>
}

// Bumped on every write so the gate computed re-reads localStorage.
const nudgeStateVersion = ref(0)

function readNudgeState(): NudgeState {
  // Corrupted state falls back to fresh.
  return loadJSON<NudgeState>(NUDGE_STORAGE_KEY, { lastGlobalShownDay: '', byExercise: {} })
}

function writeNudgeState(state: NudgeState) {
  localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(state))
  nudgeStateVersion.value++
}

/**
 * Settles a pending nudge outcome lazily at modal open. Merely closing the
 * modal or skipping a day is NOT an ignore — only a later session whose top
 * set stayed below the suggestion counts. Also forgives a muted exercise
 * once its habitual top weight actually moves.
 */
function settleNudgeOutcome(exerciseId: string) {
  const state = readNudgeState()
  const mine = state.byExercise[exerciseId]
  if (!mine) return
  let changed = false

  if (mine.outcome === 'pending' && mine.lastShownDay !== todayISO()) {
    const ex = store.exercises.find(e => e.id === exerciseId)
    const topByDay = new Map<string, number>()
    for (const s of ex?.sets ?? []) {
      const day = setDayKey(s.date)
      if (day <= mine.lastShownDay) continue
      topByDay.set(day, Math.max(topByDay.get(day) ?? 0, s.weight))
    }
    // The user's next session after the nudge answers "did they take it?"
    const firstDayAfter = [...topByDay.keys()].sort()[0]
    if (firstDayAfter !== undefined) {
      const top = topByDay.get(firstDayAfter)!
      if (top >= mine.shownForWeightLbs - LADDER_MATCH_TOLERANCE) {
        mine.outcome = 'accepted'
        mine.ignoredCount = 0
      } else {
        mine.outcome = 'ignored'
        mine.ignoredCount++
      }
      changed = true
    }
  }

  // Mute escape hatch: the habitual top weight moved → forgive past ignores.
  const topRung = usualLadder.value?.rungs[usualLadder.value.rungs.length - 1]
  if (mine.ignoredCount >= NUDGE_COOLDOWNS.length && topRung &&
      Math.abs(topRung.weightLbs - (mine.shownForWeightLbs - NUDGE_WEIGHT_INCREMENT)) > LADDER_MATCH_TOLERANCE) {
    mine.ignoredCount = 0
    changed = true
  }

  if (changed) writeNudgeState(state)
}

/** Rounds a raw-lbs suggestion UP to the next achievable display increment (5 lbs / 2.5 kg). */
function roundUpDisplayWeight(lbs: number): number {
  if (weightUnit.value === 'kg') {
    return Math.ceil((lbs * 0.453592) / 2.5) * 2.5
  }
  return Math.ceil(lbs / 5) * 5
}

const overloadNudge = computed(() => {
  void nudgeStateVersion.value // re-evaluate after state writes
  // Gate 1: log mode for an existing exercise, today, both fields empty.
  if (!ladderActive.value || weightStr.value !== '' || repsStr.value !== '') return null
  // Gate 2: the habitual top set is the one up next.
  const rungs = usualLadder.value!.rungs
  if (nextRungIndex.value !== rungs.length - 1) return null
  // Gate 3: the data strongly supports going heavier (today's in-progress
  // session excluded — its partial top set would mask the signal).
  const id = selectedExerciseId.value
  const suggestion = store.getOverloadSuggestion(id, todayISO())
  if (!suggestion || suggestion.confidence !== 'high') return null
  const topRung = rungs[rungs.length - 1]
  // Gate 4 (deload guard): last session never reached the usual top — don't push.
  const prior = store.getLastSession(id, todayISO())
  if (!prior || prior.sets.length === 0) return null
  const priorTop = Math.max(...prior.sets.map(s => s.weight))
  if (priorTop < topRung.weightLbs - LADDER_MATCH_TOLERANCE) return null
  // Gate 5 (break guard): coming back from 3+ weeks off — ease back in.
  const today = todayISO()
  if (daysBetweenISO(prior.date, today) > NUDGE_BREAK_DAYS) return null
  // Gate 6: rate limits.
  const state = readNudgeState()
  const mine = state.byExercise[id]
  const shownTodayForMe = mine?.lastShownDay === today
  // One nudge per calendar day across ALL exercises (same-day re-show of
  // this exercise's own instance is allowed — consistency, not nagging).
  if (state.lastGlobalShownDay === today && !shownTodayForMe) return null
  if (shownTodayForMe && mine.outcome !== 'pending') return null
  if (mine && !shownTodayForMe) {
    const cooldown = NUDGE_COOLDOWNS[Math.min(mine.ignoredCount, NUDGE_COOLDOWNS.length - 1)]
    if (mine.ignoredCount >= NUDGE_COOLDOWNS.length) return null // muted
    if (daysBetweenISO(mine.lastShownDay, today) < cooldown) return null
  }

  return {
    weightLbs: suggestion.weight,
    displayWeight: roundUpDisplayWeight(suggestion.weight),
    reps: suggestion.reps,
    fromWeightLbs: topRung.weightLbs,
    fromReps: topRung.reps,
  }
})

// Record "shown" once per (exercise, calendar day); same-day modal reopens
// re-show the same instance without re-counting.
watch(overloadNudge, (n) => {
  if (!n) return
  const id = selectedExerciseId.value
  const today = todayISO()
  const state = readNudgeState()
  const mine = state.byExercise[id]
  if (mine?.lastShownDay === today) return
  state.byExercise[id] = {
    lastShownDay: today,
    shownForWeightLbs: n.weightLbs,
    outcome: 'pending',
    ignoredCount: mine?.ignoredCount ?? 0,
  }
  state.lastGlobalShownDay = today
  writeNudgeState(state)
  logEvent('overload_nudge_shown')
})

/** Tapping the card fills the fields — it never saves. The user can edit, then Save. */
function acceptOverloadNudge() {
  const n = overloadNudge.value
  if (!n) return
  if (plateMode.value) {
    const plates = weightToPlates(toLbs(n.displayWeight), currentBarWeight.value, weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES)
    if (plates) {
      currentPlates.value = plates
      syncPlateWeight()
    }
  } else {
    weightStr.value = String(n.displayWeight)
  }
  repsStr.value = String(n.reps)
  impactLight()
}

/** Called from saveSet: a logged set at or above the suggested weight accepts the nudge. */
function recordNudgeAcceptIfAny(exerciseId: string, savedWeightLbs: number) {
  const state = readNudgeState()
  const mine = state.byExercise[exerciseId]
  if (!mine || mine.outcome !== 'pending' || mine.lastShownDay !== todayISO()) return
  if (savedWeightLbs >= mine.shownForWeightLbs - LADDER_MATCH_TOLERANCE) {
    mine.outcome = 'accepted'
    mine.ignoredCount = 0
    writeNudgeState(state)
    logEvent('overload_nudge_accepted')
  }
}

// ── Plate calculator state ──────────────────────────────────────
const currentPlates = ref<number[]>([])
const previousPlates = ref<number[]>([])

const plateMode = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  return ex?.inputMode === 'plates'
})
const plateNumpadOverride = ref(false)

// ── Plate calculator hint (LIFT-388) ────────────────────────────
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
  if (ex) openEditExerciseModal(ex)
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

/** Clears the weight field from the logSetFieldClear × button (05-logset-platecalc.png). */
function clearWeight() {
  weightStr.value = ''
  weightInputEl.value?.focus()
}

/** True when the weight input has a non-empty numeric value — drives the gold
 *  border on the weight card and the visibility of the × clear button. */
const weightHasValue = computed(() => weightStr.value.trim().length > 0)

function loadPRTarget() {
  if (!prTargetWeight.value) return
  const targetLbs = toLbs(prTargetWeight.value)
  const denoms = weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES
  const barWt = currentBarWeight.value
  // Smallest weight increment: smallest plate × 2 for per-side, × 1 for total
  const smallestIncrement = denoms[denoms.length - 1] * (isPerSide.value ? 2 : 1)
  // Round up to nearest achievable weight above bar
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
  // Default: 45 for per-side (barbell), 0 for total (machine)
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

// Reverse sync: when weight changes from input/chips, update plates to match
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
const newExerciseName = ref('')
const newExerciseTags = ref<string[]>([])
const newExerciseTagInput = ref('')
const newExercisePlateMode = ref(false)
const newExercisePlateCountMode = ref<PlateCountMode>('per-side')
const newExerciseBarWeight = ref(45)
const newBarWeightEditing = ref(false)
const newBarWeightInputEl = ref<HTMLInputElement | null>(null)
// String-based raw inputs to avoid iOS keyboard dismissal on type="number"
// Vue writing back the parsed number to el.value causes iOS Safari to dismiss
// the keyboard after each keystroke. Using type="text" + inputmode avoids this.
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
// Sync plate display when weight changes from input/chips (not from plate buttons).
// Debounced to avoid recalculating plate combinations on every keystroke (LIFT-634).
let _plateSyncTimer: ReturnType<typeof setTimeout> | null = null
watch(weightStr, () => {
  if (!plateMode.value || _plateSync) return
  if (_plateSyncTimer) clearTimeout(_plateSyncTimer)
  _plateSyncTimer = setTimeout(syncPlatesFromWeight, 250)
})

const date = ref(todayISO())
// Remembers the last date the user manually set when logging, so the modal
// re-opens to that date rather than always resetting to today.
const lastLogDate = ref(todayISO())

// Trigger the native date picker from a real user-gesture click. Needed
// because desktop Chrome doesn't open the picker on input-body clicks —
// only on the built-in calendar icon — and our input is opacity:0. On iOS,
// tapping the input opens its picker natively, but showPicker() within
// the gesture is a harmless no-op if the native picker is already opening.
function tryShowDatePicker(e: MouseEvent) {
  const el = e.currentTarget as HTMLInputElement
  try { el.showPicker() } catch { /* unsupported or gesture-less; native tap handles it */ }
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

// True when logging a set for a known, pre-selected exercise
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

// Open modal to log a brand-new exercise
function openNewExerciseModal() {
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

const timelineLogPicking = ref(false)

function openTimelineLogModal() {
  timelineLogPicking.value = true
}

function pickExerciseForLog(exerciseId: string) {
  timelineLogPicking.value = false
  openLogForExercise(exerciseId)
}

/** "New exercise" row inside the picker — closes the picker and opens the
 *  new-exercise flow instead of an existing exercise. */
function pickNewExerciseFromPicker() {
  timelineLogPicking.value = false
  openNewExerciseModal()
}

// Open modal pre-targeted at a specific existing exercise
function openLogForExercise(exerciseId: string) {
  editingSet.value = null
  selectedExerciseId.value = exerciseId
  lastSessionUsed.value = {}
  intensityUsed.value = {}
  intensityPct.value = INTENSITY_DEFAULT_PCT
  date.value = lastLogDate.value
  usualLadder.value = store.getUsualLadder(exerciseId, todayISO())
  // Default the Suggestions drawer to the first available lens, opened only
  // when that lens is a quick-fill (routine/last) so the one-tap ghost-arm flow
  // is immediate; intensity/PR-only states start collapsed (clean surface).
  const lenses = suggestionLenses.value
  activeLens.value = lenses[0] ?? 'routine'
  suggestionsExpanded.value = lenses[0] === 'routine' || lenses[0] === 'last'
  settleNudgeOutcome(exerciseId)
  // Initialize plate calculator: prefer the ladder's next rung, else last set
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (exercise?.inputMode === 'plates') {
    const lastSet = exercise.sets.length > 0 ? exercise.sets[exercise.sets.length - 1] : null
    const seedWeight = (ladderActive.value && nextRung.value) ? nextRung.value.weightLbs : lastSet?.weight ?? null
    if (seedWeight !== null) {
      const barWt = exercise.barWeight ?? 45
      const plates = weightToPlates(seedWeight, barWt, weightUnit.value === 'kg' ? KG_PLATES : LBS_PLATES)
      currentPlates.value = plates || []
      previousPlates.value = plates || []
      weight.value = displayWeight(seedWeight)
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

// Open modal to edit an existing set
function openEditModal(exercise: Exercise, set: WorkoutSet) {
  editingSet.value = { exerciseId: exercise.id, setId: set.id }
  selectedExerciseId.value = exercise.id
  date.value = setDayKey(set.date)
  weight.value = displayWeight(set.weight)
  reps.value = set.reps
  showModal.value = true
}

function closeModal() {
  // Save the current date before resetting so subsequent log modals default to it.
  // Only do this in log mode — edit mode dates shouldn't affect the default.
  if (!isEditMode.value) {
    lastLogDate.value = date.value
  }
  showModal.value = false
  timerCtrl.editingPresets.value = false
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
  suggestionsExpanded.value = false
  activeLens.value = 'routine'
  usualLadder.value = null
  ghostJustSaved.value = false
  if (_ghostRearmTimer) { clearTimeout(_ghostRearmTimer); _ghostRearmTimer = null }
}

// ── Rest timer (state lives in timerCtrl composable) ────────────
// Keep screen awake while the rest timer is running or the log-set modal is open
const wakeLockNeeded = computed(() => timerCtrl.timerActive.value || showModal.value)
useWakeLock(wakeLockNeeded, wakeLockEnabled)

function skipToNextSet() {
  timerCtrl.stopTimer()
  date.value = lastLogDate.value
}

function onOverlayClick() {
  if (timerCtrl.editingPresets.value) {
    timerCtrl.editingPresets.value = false
  } else {
    closeModal()
  }
}

function dismissTimer() {
  timerCtrl.stopTimer()
  closeModal()
}

function openRestTimer() {
  showModal.value = true
  if (!timerCtrl.timerActive.value) {
    timerCtrl.startRestTimer()
  }
}


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

// ── PR target suggestions (inverse Epley) ──────────────────────
// When only one field is filled, show what's needed in the other to beat the PR
const prTargetWeight = computed<number | null>(() => {
  if (isEditMode.value || !reps.value || reps.value < 1) return null
  // Show PR suggestion when weight is empty; show live estimate when weight is filled
  if (weight.value && weight.value > 0) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  if (pr <= 0) return null
  // Account for Epley rounding: round(w * (1 + r/30)) > pr triggers at pr + 0.5
  const target = pr + 0.5
  const rawLbs = reps.value === 1 ? Math.ceil(target) : Math.ceil(target / (1 + reps.value / 30))
  // Round up to nearest achievable weight increment (5 lbs or 2.5 kg)
  // Round in display-unit space to avoid fractional conversion errors
  if (weightUnit.value === 'kg') {
    const rawKg = rawLbs * 0.453592
    const roundedKg = Math.ceil(rawKg / 2.5) * 2.5
    return roundedKg
  }
  const targetLbs = Math.ceil(rawLbs / 5) * 5
  return targetLbs
})

// ── Live XP preview (shown when both weight and reps are filled) ──
// Debounced XP preview — the underlying calculation is expensive (1RM, rep PR,
// streak multiplier) and triggers on every keystroke in weight/reps inputs.
// We debounce by 150ms so the preview updates after the user pauses typing,
// keeping INP low during rapid input. (#632)
type XPPreviewResult = { xp: number; zone: string; best1RM: number | null; isRepPR: boolean; isNewWeight: boolean }
const liveXPPreview = ref<XPPreviewResult | null>(null)
let _xpPreviewTimer: ReturnType<typeof setTimeout> | undefined

function _computeXPPreview(): XPPreviewResult | null {
  if (!progressionStore.progressionEnabled || !progressionStore.showProgression) return null
  if (!liveEstimateLbs.value || isEditMode.value) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null

  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null

  const estimated1RM = liveEstimateLbs.value
  const w = toLbs(weight.value!)
  const r = reps.value!

  const { best1RM, isRepPR, isNewWeight, ratio, baseXP } = scoreSet({
    priorSets: exercise.sets,
    estimated1RM,
    weightLbs: w,
    reps: r,
    dateKey: date.value || todayISO(),
    baseline: prBaselineDate.value,
  })
  const xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, new Date().toISOString())

  let zone: string
  if (best1RM === null || ratio === null) {
    zone = 'New Exercise'
  } else if (ratio > 1.0) {
    zone = `PR! (${XP_CONFIG.prMultiplier}x)`
  } else if (ratio === 1.0) {
    zone = `Tied PR (${XP_CONFIG.tieMultiplier}x)`
  } else if (ratio < XP_CONFIG.warmupThreshold) {
    zone = 'Warmup'
  } else {
    zone = `${Math.round(ratio * 100)}% of best`
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
  if (reps.value && reps.value >= 1) return null // both filled
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id, prBaselineDate.value)
  if (pr <= 0) return null
  const wLbs = toLbs(weight.value)
  // Account for Epley rounding: round(w * (1 + r/30)) > pr triggers at pr + 0.5
  if (Math.round(wLbs) > pr) return 0 // any rep beats it (1RM at this weight already exceeds PR)
  const needed = Math.ceil(30 * ((pr + 0.5) / wLbs - 1))
  // Epley at reps=1 uses weight directly (1RM = weight), not the formula.
  // If the formula says 1 rep but weight doesn't beat PR, need at least 2 reps.
  if (needed <= 1 && Math.round(wLbs) <= pr) return 2
  return needed
})

// Lenses available in the Suggestions drawer, in display order. Routine and
// last-session are mutually exclusive (a detected routine supersedes the raw
// last session); the intensity lens appends whenever there's a 1RM to anchor to
// (the slider may land on an empty table at extreme positions — that's fine,
// it's transient). The former separate "PR" lens is now the 100% end of the
// intensity slider (ceiling rounding), so there's nothing extra to push (#770).
const suggestionLenses = computed<SuggestionLens[]>(() => {
  if (isEditMode.value || !isLogForExercise.value) return []
  const lenses: SuggestionLens[] = []
  if (ladderActive.value) lenses.push('routine')
  else if (lastSession.value) lenses.push('last')
  if (intensityOneRM.value !== null) lenses.push('intensity')
  return lenses
})

// The effectively-shown lens: the user's selection if still available, else the
// first available lens. Keeps the body coherent when data shifts (e.g. backdate
// drops the routine lens) without needing a watcher to reset activeLens.
const currentLens = computed<SuggestionLens | null>(() => {
  const lenses = suggestionLenses.value
  if (!lenses.length) return null
  return lenses.includes(activeLens.value) ? activeLens.value : lenses[0]
})

function lensLabel(lens: SuggestionLens): string {
  switch (lens) {
    case 'routine': return 'Routine'
    case 'last': return 'Last'
    case 'intensity': return 'Intensity'
  }
}

// Collapsed-header summary: the names of the available lenses (e.g.
// "Routine · Intensity") so the drawer advertises its contents at a glance.
const suggestionHeaderSub = computed(() => suggestionLenses.value.map(lensLabel).join(' · '))

// ── Personal bests from actual history ──────────────────────────
// Best reps at the entered weight (exact match in lbs)
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

// Heaviest weight at the entered rep count (exact match)
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

const hasSetData = computed(() => weight.value !== null && weight.value > 0 && weight.value <= MAX_WEIGHT && reps.value !== null && reps.value >= 1 && reps.value <= MAX_REPS)

const canSave = computed(() => {
  if (isEditMode.value) return hasSetData.value
  if (selectedExerciseId.value === '__new__') return newExerciseName.value.length > 0
  return selectedExerciseId.value !== '' && (hasSetData.value || ghostArmed.value)
})

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
        const { isPR: editIsPR, isRepPR: editIsRepPR, zone: editZone, baseXP } = scoreSet({
          priorSets: otherSets,
          estimated1RM: set.estimated1RM,
          weightLbs: set.weight,
          reps: set.reps,
          dateKey: set.date,
          baseline: prBaselineDate.value,
        })
        const xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, set.date)
        progressionStore.recalcSetXP(editSetId, xp, { theme: currentTheme.value, epoch: progressionStore.epoch, zone: editZone, isPR: editIsPR, isRepPR: editIsRepPR })
      }
    }
    closeModal()
  } else {
    let exerciseId: string = selectedExerciseId.value
    const isNew = exerciseId === '__new__'
    if (isNew) {
      // Auto-add any pending tag text
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
    const typedSet = hasSetData.value && weight.value !== null && reps.value !== null
    if (typedSet || ghostArmed.value) {
      // Ghost save: commit the next rung's canonical stored lbs directly — no
      // toLbs round-trip drift for kg users, so the set reinforces its cluster.
      const effWeightLbs = typedSet ? toLbs(weight.value!) : nextRung.value!.weightLbs
      const effReps = typedSet ? reps.value! : nextRung.value!.reps
      // A ghost save replays a habitual set — it can never be a PR.
      const wasPR = typedSet ? isNewPR.value : false
      if (!typedSet) {
        // Disarm briefly so an accidental double-tap can't log two rungs.
        ghostJustSaved.value = true
        if (_ghostRearmTimer) clearTimeout(_ghostRearmTimer)
        _ghostRearmTimer = setTimeout(() => { ghostJustSaved.value = false }, GHOST_REARM_MS)
      }
      // Capture the pre-log baseline PR so the burst can show old → new e1RM.
      const oldE1RM = store.getExercisePR(exerciseId, prBaselineDate.value)
      // Snapshot PR count before logging so we can detect the user's very first PR.
      const prCountBefore = wasPR ? progressionStore.totalPRCount : 0
      store.logSet(exerciseId, effWeightLbs, effReps, date.value)
      recordNudgeAcceptIfAny(exerciseId, effWeightLbs)
      logEvent('set_log', { exercise: selectedExerciseName.value, isPR: wasPR })
      // XP: get the just-logged set (last in array) and compute XP
      const exercise = store.exercises.find(e => e.id === exerciseId)
      if (exercise && exercise.sets.length > 0) {
        const newSet = exercise.sets[exercise.sets.length - 1]
        computeAndLogXP(exerciseId, newSet.id, newSet.estimated1RM, newSet.weight, newSet.reps)
      }
      // Haptic feedback — stronger for PRs
      if (wasPR) {
        notifySuccess()
        // Full-bleed PR celebration (respects the PR baseline via oldE1RM,
        // and the prCelebrations opt-out inside presentPRBurst).
        const newE1RM = store.getExercisePR(exerciseId, prBaselineDate.value)
        presentPRBurst({
          exerciseName: selectedExerciseName.value,
          oldE1RM,
          newE1RM,
          setWeight: effWeightLbs,
          setReps: effReps,
          isFirstPR: prCountBefore === 0,
          rawDate: date.value || todayISO(),
        })
        if (prCountBefore === 0) {
          logEvent('first_pr', { exercise: selectedExerciseName.value })
        }
      }
      // Celebrate the first weekly-goal completion of the week (LIFT-764). When
      // it fires its own success/milestone haptic, suppress the routine light
      // tap: two native haptics fired back-to-back collapse into a muddy /
      // truncated buzz on Capacitor/iOS. The light tap stays for the common
      // non-PR, no-celebration path. (PRs already played notifySuccess above and
      // skip the goal banner, so they never reach the light tap.)
      const celebrated = maybeCelebrateWeeklyGoal(wasPR)
      if (!wasPR && !celebrated) {
        impactLight()
      }
      if (restTimerEnabled.value && restTimerAutoStart.value) {
        timerCtrl.startRestTimer()
      }
      // Clear fields and stay on the modal for the next set
      plateNumpadOverride.value = false
      if (plateMode.value) {
        // Keep plate config for next set (user adjusts, not reloads)
        previousPlates.value = [...currentPlates.value]
        reps.value = null
      } else {
        weight.value = null
        reps.value = null
      }
      nextTick(() => weightInputEl.value?.focus())
    } else {
      closeModal()
    }
  }
}

// ── Undo-able destructive actions ────────────────────────────────
function undoDeleteSet(exerciseId: string, set: WorkoutSet) {
  store.deleteSet(exerciseId, set.id, { sync: false })
  logEvent('set_delete')
  showUndo(
    'Set deleted',
    () => store.restoreSet(exerciseId, set),
    () => {
      store.syncDeleteSet(set.id)
      progressionStore.removeSetXP(set.id)
    },
  )
}

function undoDeleteExercise(exercise: Exercise) {
  const saved = { ...exercise, sets: [...exercise.sets] }
  const idx = store.exercises.indexOf(exercise)
  if (detailExerciseId.value === exercise.id) detailExerciseId.value = null
  store.deleteExercise(exercise.id, { sync: false })
  logEvent('exercise_delete')
  showUndo(
    `"${saved.name}" deleted`,
    () => store.restoreExercise(saved, idx),
    () => {
      store.syncDeleteExercise(saved.id)
      saved.sets.forEach(s => progressionStore.removeSetXP(s.id))
    },
  )
}

// ── Archive ────────────────────────────────────────────────────
const archivedOpen = ref(false)
const archivedListId = 'wt-archived-list'

function handleArchiveFromEdit() {
  const id = editTarget.value
  if (!id) return
  const ex = store.exercises.find(e => e.id === id)
  if (!ex) return
  const name = ex.name
  if (detailExerciseId.value === id) detailExerciseId.value = null
  store.archiveExercise(id)
  editTarget.value = null
  logEvent('exercise_archive')
  showUndo(
    `"${name}" archived`,
    () => store.unarchiveExercise(id),
    () => { /* commit: archive already applied — no-op */ },
  )
}

function handleUnarchiveFromEdit() {
  const id = editTarget.value
  if (!id) return
  store.unarchiveExercise(id)
  editTarget.value = null
  archivedOpen.value = false
  logEvent('exercise_unarchive')
}

function unarchiveExerciseFromList(exerciseId: string) {
  store.unarchiveExercise(exerciseId)
  logEvent('exercise_unarchive')
}

// ── Edit exercise modal (extracted to EditExerciseModal.vue) ─────
// The parent owns which exercise is being edited and applies the saved
// form to the store; the modal owns the transient form state.
const editTarget = ref<string | null>(null)

const editTargetExercise = computed<Exercise | null>(() =>
  store.exercises.find(e => e.id === editTarget.value) ?? null
)

function openEditExerciseModal(exercise: Exercise) {
  editTarget.value = exercise.id
}

function onEditExerciseSave(payload: EditExerciseSave) {
  if (!editTarget.value) return
  store.renameExercise(editTarget.value, payload.name)
  store.updateExerciseTags(editTarget.value, payload.tags)
  // Save input mode and plate settings
  store.setExerciseInputMode(editTarget.value, payload.plateMode ? 'plates' : 'numpad')
  if (payload.plateMode) {
    store.setExercisePlateCountMode(editTarget.value, payload.plateCountMode)
    store.setExerciseBarWeight(editTarget.value, payload.barWeight)
  }
  store.setExerciseIntensityMaxReps(editTarget.value, payload.intensityMaxReps)
  editTarget.value = null
  // When switching to plate mode, reverse-sync the current weight into
  // plates so the user's entered value is preserved (LIFT-388 review fix).
  if (payload.plateMode && weight.value) {
    syncPlatesFromWeight()
  } else {
    syncPlateWeight()
  }
  logEvent('exercise_edit')
}

function onEditExerciseDelete() {
  const exercise = editTargetExercise.value
  if (!exercise) return
  undoDeleteExercise(exercise)
  editTarget.value = null
}

// ── Tag manager (extracted to TagManagerModal.vue) ─────────────
const tagManagerOpen = ref(false)

function openTagManager() {
  tagManagerOpen.value = true
}

function toggleExerciseTag(exerciseId: string, tag: string) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (!exercise) return
  const has = exercise.tags.includes(tag)
  const newTags = has
    ? exercise.tags.filter(t => t !== tag)
    : [...exercise.tags, tag]
  store.updateExerciseTags(exerciseId, newTags)
}

function onRenameTag(oldName: string, newName: string) {
  store.renameTag(oldName, newName)
  logEvent('tag_rename')
}

function confirmDeleteTag(tag: string) {
  // Track which exercises have this tag for undo
  const affectedIds = store.exercises
    .filter(e => (e.tags || []).includes(tag))
    .map(e => e.id)
  const count = affectedIds.length
  store.deleteTag(tag)
  logEvent('tag_delete')
  showUndo(
    `Tag "${tag}" removed from ${count} exercise${count !== 1 ? 's' : ''}`,
    () => {
      // Undo: re-add tag to affected exercises
      affectedIds.forEach(id => {
        const exercise = store.exercises.find(e => e.id === id)
        if (exercise && !exercise.tags.includes(tag)) {
          store.updateExerciseTags(id, [...exercise.tags, tag])
        }
      })
    },
    () => {}
  )
}


// ── Focus traps for v-if modals ─────────────────────────────────
watch(showModal, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.repMaxModal')
    if (el) logModalFocus.activate(el)
    // Attach swipe-to-dismiss gesture to the log-set sheet (step 5f).
    // The handle gets touch events so the gesture doesn't compete with
    // native scroll inside the sheet body.
    if (logSheetEl.value && logSheetHandleEl.value) {
      logSwipe.attach(logSheetEl.value, logSheetHandleEl.value)
    }
  } else {
    logModalFocus.deactivate()
    logSwipe.detach()
  }
})

// ── Lock background scroll when any modal is open (iOS) ────────
watch(
  () => showModal.value || !!detailExerciseId.value || editTarget.value !== null || tagManagerOpen.value,
  (open) => { document.documentElement.classList.toggle('modal-open', open) },
)
onUnmounted(() => {
  timerCtrl.stopTimer()
  clearTimeout(_xpPreviewTimer)
  if (_plateSyncTimer) clearTimeout(_plateSyncTimer)
  document.documentElement.classList.remove('modal-open')
})

// openNewExerciseModal is exposed so App.vue's top-bar "+" can open the
// new-exercise modal directly (the primary "add exercise" entry point).
// openTimelineLogModal is exposed for the timeline view's "Log a set" button
// and for unit tests; it opens the exercise picker used to quick-log a set.
defineExpose({ openTimelineLogModal, openNewExerciseModal, timerCtrl })
</script>
