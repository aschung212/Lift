<template>
  <!-- Main card -->
  <div class="wtCard">
    <div class="wtCardHeader">
      <h2 class="wtTitle">Exercise Tracker</h2>
      <button v-if="listView === 'exercises'" class="wtLogBtn" @click="openNewExerciseModal">+ New Exercise</button>
      <button v-else class="wtLogBtn" @click="openTimelineLogModal">+ Log Set</button>
    </div>

    <!-- View toggle -->
    <div v-if="store.exercises.length > 0" class="wtViewToggle">
      <button :class="['wtViewToggleBtn', { active: listView === 'exercises' }]" @click="listView = 'exercises'">Exercises</button>
      <button :class="['wtViewToggleBtn', { active: listView === 'timeline' }]" @click="listView = 'timeline'">Timeline</button>
    </div>

    <!-- Tag filter (exercises view only) -->
    <template v-if="listView === 'exercises' && store.allTags.length > 0">
      <div class="wtTagFilterBar">
        <button
          v-for="tag in store.allTags"
          :key="tag"
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
          :aria-pressed="activeTagFilters.includes(tag)"
          @click="toggleTagFilter(tag)"
        >{{ tag }}</button>
        <button
          v-if="activeTagFilters.length > 0"
          class="wtTagChip wtTagChipClear"
          @click="activeTagFilters = []"
        >× Clear</button>
        <button
          class="wtTagChip wtTagChipManage"
          @click="openTagManager"
          aria-label="Manage tags"
        ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
      </div>
    </template>

    <!-- Search bar (exercises view, shown when 5+ exercises) -->
    <div v-if="listView === 'exercises' && store.exercises.length >= 5" class="wtSearchBar">
      <input
        v-model="searchQuery"
        type="search"
        autocomplete="off"
        class="wtSearchInput"
        placeholder="Search exercises…"
        aria-label="Search exercises"
      />
      <span v-if="searchQuery" class="wtSearchCount">{{ filteredExercises.length }} result{{ filteredExercises.length !== 1 ? 's' : '' }}</span>
    </div>

    <p v-if="store.exercises.length === 0" class="wtEmpty">
      No exercises yet. Hit "+ New Exercise" to add your first one.
    </p>

    <template v-else-if="listView === 'exercises'">
    <p v-if="filteredExercises.length === 0" class="wtEmpty">
      No exercises match your search.
    </p>

    <ul v-else class="wtExerciseList" ref="exerciseListEl">
      <li
        v-for="(exercise, index) in filteredExercises"
        :key="exercise.id"
        class="wtExerciseItem"
        :class="{
          'wt-dragging': activeTagFilters.length === 0 && dragState.dragging && dragState.fromIndex === index,
          'wt-drag-over': activeTagFilters.length === 0 && dragState.dragging && dragState.overIndex === index && dragState.fromIndex !== index,
        }"
        :data-index="index"
      >
        <div class="wtExerciseHeader">
          <span
            :class="['wtDragHandle', { wtDragHandleDisabled: activeTagFilters.length > 0 }]"
            @touchstart.prevent="activeTagFilters.length === 0 && onDragStart(index, $event)"
            @mousedown="activeTagFilters.length === 0 && onDragStart(index, $event)"
            aria-label="Drag to reorder"
          >⠿</span>
          <button
            class="wtExerciseRow"
            @click="openDetailModal(exercise.id)"
          >
            <div class="wtExerciseNameBlock">
              <span class="wtExerciseName">{{ exercise.name }}</span>
              <span v-if="store.getExercisePRSet(exercise.id)" class="wtExerciseMeta">
                Est. 1RM: {{ displayWeight(store.getExercisePRSet(exercise.id)!.estimated1RM) }} {{ weightUnit }}
                ({{ displayWeight(store.getExercisePRSet(exercise.id)!.weight) }} × {{ store.getExercisePRSet(exercise.id)!.reps }})
              </span>
            </div>
            <span class="wtChevron">›</span>
          </button>
          <button
            class="wtExerciseLogBtn"
            @click="openLogForExercise(exercise.id)"
            :aria-label="`Log a set for ${exercise.name}`"
          >+ Log</button>
        </div>
      </li>
    </ul>
    </template>

    <!-- Timeline view -->
    <template v-else-if="listView === 'timeline'">
      <div v-if="timelineSets.length === 0" class="wtEmpty">
        No sets logged yet.
      </div>
      <div v-else class="wtTimeline">
        <template v-for="group in visibleTimelineGroups" :key="group.key">
          <p class="wtTimelineDateHeader">{{ group.label }}</p>
          <div class="wtSetCard">
            <div
              v-for="entry in group.sets"
              :key="entry.set.id"
              :class="['wtTimelineRow', { wtTimelineRowActive: activeSetId === entry.set.id }]"
              @click="toggleSetActions(entry.set.id)"
            >
              <div class="wtTimelineRowMain">
                <span class="wtTimelineExName">{{ entry.exerciseName }}</span>
                <span class="wtTimelineSetDetail">{{ displayWeight(entry.set.weight) }} {{ weightUnit }} × {{ entry.set.reps }}</span>
                <span class="wtTimelineE1RM">~{{ displayWeight(entry.set.estimated1RM) }}</span>
              </div>
              <div v-if="activeSetId === entry.set.id" class="wtSetActions">
                <button class="wtSetBtn" @click.stop="openEditModal(store.exercises.find(e => e.id === entry.exerciseId)!, entry.set)" aria-label="Edit set">Edit</button>
                <button class="wtSetBtn wtSetBtnDel" @click.stop="undoDeleteSet(entry.exerciseId, entry.set)" aria-label="Delete set">Delete</button>
              </div>
            </div>
          </div>
        </template>
        <button v-if="timelineLimit < timelineSets.length" class="wtTimelineShowMore" @click="timelineLimit += 50">
          Show more ({{ timelineSets.length - timelineLimit }} remaining)
        </button>
      </div>
    </template>

  </div>

  <!-- Exercise detail modal -->
  <Teleport to="body">
    <div v-if="detailExercise" class="repMaxOverlay" @click.self="detailExerciseId = null" @keydown.escape="detailExerciseId = null">
      <div class="wtDetailModal" ref="detailSheetEl" :style="detailSwipe.dragStyle()" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
        <div class="sheetDragHandle" ref="detailHandleEl" aria-hidden="true"><span class="sheetDragPill"></span></div>
        <div class="wtDetailHeader">
          <button class="wtDetailBack" @click="detailExerciseId = null" aria-label="Back to exercise list">‹ Back</button>
          <h2 class="wtDetailTitle" id="detail-modal-title">{{ detailExercise.name }}</h2>
          <button class="wtDetailEditBtn" @click="openEditExerciseModal(detailExercise)" :aria-label="`Edit ${detailExercise.name}`">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>

        <div class="wtDetailBody">
          <!-- Progress graph -->
          <ExerciseGraph :exercise="detailExercise" :mode="detailTab" />

          <!-- Detail tabs -->
          <div class="wtDetailTabs">
            <button :class="['wtDetailTab', { active: detailTab === 'sets' }]" @click="detailTab = 'sets'">
              All Sets <span class="wtDetailTabCount">{{ detailExercise.sets.length }}</span>
            </button>
            <button :class="['wtDetailTab', { active: detailTab === 'prs' }]" @click="detailTab = 'prs'" v-if="prHistory.length > 1">
              PRs <span class="wtDetailTabCount">{{ prHistory.length }}</span>
            </button>
          </div>

          <!-- All Sets view -->
          <template v-if="detailTab === 'sets'">
            <div class="wtSetList">
              <p v-if="detailExercise.sets.length === 0" class="wtSetEmpty">No sets logged yet.</p>
              <template v-for="group in groupedSets" :key="group.key">
                <p class="wtSetDateHeader">{{ formatDate(group.date) }}</p>
                <div class="wtSetCard">
                  <div
                    v-for="set in group.sets"
                    :key="set.id"
                    class="wtSetRow"
                    :class="{
                      wtSetRowPR: set.estimated1RM === store.getExercisePR(detailExercise.id) && set.date.slice(0,10) === detailPRDate,
                      'wtSetRowActive': activeSetId === set.id,
                    }"
                    @click="toggleSetActions(set.id)"
                  >
                    <span class="wtSetDetail">{{ displayWeight(set.weight) }} {{ weightUnit }} × {{ set.reps }}</span>
                    <span class="wtSet1RM">
                      ~{{ displayWeight(set.estimated1RM) }} {{ weightUnit }}
                      <span v-if="set.estimated1RM === store.getExercisePR(detailExercise.id) && set.date.slice(0,10) === detailPRDate" class="wtSetPR">🏆</span>
                    </span>
                    <div v-if="activeSetId === set.id" class="wtSetActions">
                      <button
                        class="wtSetBtn"
                        @click.stop="openEditModal(detailExercise, set)"
                        aria-label="Edit set"
                      >Edit</button>
                      <button
                        class="wtSetBtn wtSetBtnDel"
                        @click.stop="undoDeleteSet(detailExercise.id, set)"
                        aria-label="Delete set"
                      >Delete</button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <div v-if="detailExercise.sets.length > SET_LIMIT" class="wtClearWrap">
              <button class="wtShowAllBtn" @click="toggleShowAll(detailExercise.id)">
                {{ showAllSets.has(detailExercise.id) ? 'Show less' : `Show all ${detailExercise.sets.length} sets` }}
              </button>
            </div>
          </template>

          <!-- PRs view -->
          <template v-else-if="detailTab === 'prs'">
            <div class="wtPRHistoryList">
              <template v-for="(pr, i) in prHistory" :key="pr.id">
                <div :class="['wtPRCard', { wtPRCardCurrent: i === 0 }]">
                  <div class="wtPRCardTop">
                    <span class="wtPRCardValue">{{ displayWeight(pr.weight) }} <span class="wtPRCardUnit">{{ weightUnit }}</span> <span class="wtPRCardReps">× {{ pr.reps }}</span></span>
                    <span v-if="i === 0" class="wtPRCardBadge">Current</span>
                  </div>
                  <div class="wtPRCardBottom">
                    <span>{{ formatDate(pr.date) }}</span>
                    <span class="wtPRCardSep">·</span>
                    <span>e1RM ~{{ displayWeight(pr.estimated1RM) }} {{ weightUnit }}</span>
                  </div>
                </div>
                <div v-if="pr.e1rmDelta != null" class="wtPRConnector">
                  <span class="wtPRConnectorArrow">↑</span>
                  <span>+{{ displayWeight(pr.e1rmDelta) }} {{ weightUnit }}</span>
                  <span class="wtPRConnectorSep">·</span>
                  <span class="wtPRConnectorDays">{{ pr.daysSince }}d</span>
                </div>
              </template>
            </div>
          </template>

        </div>

        <!-- Fixed footer -->
        <div class="wtDetailFooter">
          <button class="wtDetailFooterBtn" @click="openLogForExercise(detailExercise.id)" :aria-label="`Log a set for ${detailExercise.name}`">+ Log Set</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Log / Edit Set Modal -->
  <Teleport to="body">
    <div v-if="showModal" class="repMaxOverlay" @click.self="onOverlayClick" @keydown.escape="closeModal">
      <div class="repMaxModal" @click.self="editingPresets = false" role="dialog" aria-modal="true" aria-labelledby="log-modal-title">

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
              <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="newPresetValue" placeholder="Add seconds" min="5" max="600" @keyup.enter="addPreset" ref="presetInputEl" />
              <button class="wtTimerEditAddBtn" :disabled="!newPresetValue" @click="addPreset">Add</button>
            </div>
            <div v-else class="wtTimerEditRow" style="margin-top: var(--space-2)">
              <input class="wtTimerEditInput" type="number" inputmode="numeric" autocomplete="off" v-model.number="newWarningValue" placeholder="Add seconds" min="1" max="120" @keyup.enter="addWarningOption" />
              <button class="wtTimerEditAddBtn" :disabled="!newWarningValue" @click="addWarningOption">Add</button>
            </div>
            <button class="wtTimerEditResetBtn" @click="resetAllDefaults">Reset to defaults</button>
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
            <div class="wtTimerRingInner" aria-live="polite" aria-atomic="true">
              <span :class="['wtTimerTime', { wtTimerTimeDone: timerSeconds === 0 }]">{{ timerDisplay }}</span>
              <span class="wtTimerLabel">{{ timerSeconds === 0 ? 'Done' : 'remaining' }}</span>
            </div>
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
                    <span class="iosToggleKnob" />
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
                      <span class="iosStepperValue">{{ newExerciseBarWeight }} {{ weightUnit }}</span>
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
            <span class="wtSectionDividerLine" />
            <span class="wtSectionDividerText">Log a set (optional)</span>
            <span class="wtSectionDividerLine" />
          </div>
          <!-- Plate mode: reps stepper first, then weight (closer to plate calc) -->
          <template v-if="plateMode && !isEditMode">
            <div class="wtRepsStepperFull">
              <span class="wtRepsStepperLabel">Reps</span>
              <div class="wtRepsStepperBar">
                <button class="wtRepsStepBtnLg" @click="adjustReps(-1)" :disabled="!reps || reps <= 1" aria-label="Decrease reps">−</button>
                <input
                  v-model="repsStr"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="8"
                  class="wtRepsStepperInput"
                />
                <button class="wtRepsStepBtnLg" @click="adjustReps(1)" :disabled="reps !== null && reps >= MAX_REPS" aria-label="Increase reps">+</button>
              </div>
            </div>
            <!-- Hidden weight input for data binding + numpad focus target -->
            <input
              ref="weightInputEl"
              v-model="weightStr"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="wtHiddenWeightInput"
              @blur="plateNumpadOverride = false"
            />
          </template>
          <!-- Numpad / edit mode: side-by-side weight + reps -->
          <div v-else class="wtInputRow">
            <label class="repMaxLabel" style="flex:1">
              Weight ({{ weightUnit }})
              <div class="repMaxInputRow">
                <input
                  ref="weightInputEl"
                  v-model="weightStr"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="135"
                  class="repMaxInput"
                />
              </div>
            </label>

            <label class="repMaxLabel" style="flex:1">
              Reps
              <div class="repMaxInputRow">
                <input
                  v-model="repsStr"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  placeholder="8"
                  class="repMaxInput"
                />
              </div>
            </label>
          </div>

          <!-- Live 1RM estimate / PR target — shown between inputs and plate calc -->
          <div v-if="liveEstimate" class="repMaxResult">
            <span class="repMaxResultLabel">Estimated 1RM{{ liveXPPreview?.best1RM ? ` (Best: ${liveXPPreview.best1RM} ${weightUnit})` : '' }}</span>
            <span class="repMaxResultValue">{{ liveEstimate }} {{ weightUnit }}</span>
            <span v-if="isNewPR" class="wtPrBadge">New PR! 🏆</span>
            <span v-if="liveXPPreview" class="wtXPPreview">{{ liveXPPreview.zone }}{{ liveXPPreview.isRepPR ? ` · Rep PR (${XP_CONFIG.repPRMultiplier}x)` : liveXPPreview.isNewWeight ? ' · New weight' : '' }} · {{ liveXPPreview.xp }} XP</span>
          </div>
          <div v-else-if="prTargetWeight" class="repMaxResult repMaxResultTarget">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ prTargetWeight }} {{ weightUnit }} × {{ reps }}</span>
            <span v-if="bestWeightAtReps" class="repMaxPersonalBest">Your best at {{ reps }} rep{{ reps === 1 ? '' : 's' }}: {{ displayWeight(bestWeightAtReps) }} {{ weightUnit }}</span>
          </div>
          <div v-else-if="prTargetReps === 0" class="repMaxResult repMaxResultTarget">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ displayWeight(toLbs(weight!)) }} {{ weightUnit }} × 1 🏆</span>
            <span class="repMaxPersonalBest">Any rep at this weight is a new PR</span>
          </div>
          <div v-else-if="prTargetReps" class="repMaxResult repMaxResultTarget">
            <span class="repMaxResultLabel">To Beat Your Est. 1RM</span>
            <span class="repMaxResultValue">{{ displayWeight(toLbs(weight!)) }} {{ weightUnit }} × {{ prTargetReps }}</span>
            <span v-if="bestRepsAtWeight" class="repMaxPersonalBest">Your best at {{ displayWeight(toLbs(weight!)) }} {{ weightUnit }}: {{ bestRepsAtWeight }} rep{{ bestRepsAtWeight === 1 ? '' : 's' }}</span>
            <span v-else class="repMaxPersonalBest">New weight — first attempt at {{ displayWeight(toLbs(weight!)) }} {{ weightUnit }}</span>
          </div>
          <div v-else-if="!isEditMode && isLogForExercise" class="repMaxResult repMaxResultPlaceholder">
            <span class="repMaxResultLabel">Estimated 1RM</span>
            <span class="repMaxResultPlaceholderText">Enter weight and reps to see estimate</span>
          </div>

          <!-- Plate calculator (shown when exercise is in plates mode) -->
          <div v-if="plateMode && !isEditMode" class="wtPlateCalc">
            <div class="wtPlateDisplay">
              <button class="wtPlateWeightBtn" @click="onWeightInputFocus(); weightInputEl?.focus()">{{ weight || 0 }} {{ weightUnit }}</button>
              <span class="wtPlateBreakdown">
                {{ currentPlates.length > 0 ? `${currentBarWeight > 0 ? 'Bar + ' : ''}${formatPlates(currentPlates)}${isPerSide ? ' per side' : ''}` : currentBarWeight > 0 ? 'Bar only' : 'No plates' }}
              </span>
            </div>
            <div class="wtPlateButtons">
              <div v-for="denom in activeDenominations" :key="denom" class="wtPlateGroup">
                <button class="wtPlateBtn wtPlateBtnAdd" @click="addPlate(denom)">+</button>
                <div class="wtPlateDenomWrap">
                  <span class="wtPlateDenom">{{ denom }}</span>
                  <span class="wtPlateCount">{{ plateCounts.get(denom) ? `×${plateCounts.get(denom)}` : '' }}</span>
                </div>
                <button class="wtPlateBtn wtPlateBtnRemove" @click="removePlate(denom)" :disabled="!currentPlates.includes(denom)">−</button>
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


  <!-- Edit Exercise Modal -->
  <Teleport to="body">
    <div v-if="editTarget !== null" class="repMaxOverlay" @click.self="editTarget = null" @keydown.escape="editTarget = null">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="edit-exercise-title">
        <h2 id="edit-exercise-title">Edit Exercise</h2>
        <label class="repMaxLabel">
          Name
          <div class="repMaxInputRow">
            <input
              v-model.trim="editName"
              type="text"
              class="repMaxInput"
              autocomplete="off"
              maxlength="50"
            />
          </div>
        </label>
        <div class="repMaxLabel">
          Tags
          <div class="wtTagPicker">
            <button
              v-for="tag in availableEditTags"
              :key="tag"
              :class="['wtTagPickerChip', { wtTagPickerChipActive: editTags.includes(tag) }]"
              :style="!editTags.includes(tag)
                ? { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }
                : {}"
              @click="toggleEditTag(tag)"
            >{{ tag }}</button>
            <span v-if="editTagAdding" class="wtTagInlineAdd">
              <input
                v-model.trim="newTagInput"
                type="text"
                autocomplete="off"
                placeholder="Tag name"
                maxlength="30"
                class="wtTagInlineInput"
                ref="editTagInputEl"
                @keyup.enter="addEditTag"
                @blur="finishEditTagAdd"
              />
            </span>
            <button v-else class="wtTagPickerChip wtTagAddChip" @mousedown.prevent @click="startEditTagAdd" aria-label="Add tag">+</button>
          </div>
        </div>
        <!-- Plate calculator settings (iOS grouped style) -->
        <div class="iosSettingsSection">
          <span class="iosSettingsHeader">Input Mode</span>
          <div class="iosSettingsGroup">
            <div class="iosSettingsRow">
              <span class="iosSettingsRowLabel">Plate calculator</span>
              <button
                class="iosToggle"
                :class="{ iosToggleOn: editPlateMode }"
                role="switch"
                :aria-checked="editPlateMode"
                @click="editPlateMode = !editPlateMode"
              >
                <span class="iosToggleKnob" />
              </button>
            </div>
            <template v-if="editPlateMode">
              <div class="iosSettingsRow">
                <span class="iosSettingsRowLabel">Counting</span>
                <div class="iosSegmentedControl">
                  <button
                    :class="['iosSegment', { iosSegmentActive: editPlateCountMode === 'per-side' }]"
                    @click="editPlateCountMode = 'per-side'"
                  >Per side</button>
                  <button
                    :class="['iosSegment', { iosSegmentActive: editPlateCountMode === 'total' }]"
                    @click="editPlateCountMode = 'total'"
                  >Total</button>
                </div>
              </div>
              <div class="iosSettingsRow">
                <span class="iosSettingsRowLabel">Starting weight</span>
                <div class="iosStepper">
                  <button class="iosStepperBtn" @click="editBarWeight = Math.max(0, editBarWeight - 5)" aria-label="Decrease weight">−</button>
                  <span class="iosStepperValue">{{ editBarWeight }} {{ weightUnit }}</span>
                  <button class="iosStepperBtn" @click="editBarWeight = Math.min(MAX_WEIGHT, editBarWeight + 5)" aria-label="Increase weight">+</button>
                </div>
              </div>
            </template>
          </div>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!editName" @click="confirmEditExercise">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="editTarget = null">Cancel</button>
        </div>
        <button
          v-if="!confirmDeleteExercise"
          class="wtEditDeleteBtn"
          @click="confirmDeleteExercise = true"
          aria-label="Delete exercise"
        >Delete Exercise</button>
        <div v-else class="wtEditDeleteConfirm">
          <span class="wtEditDeleteConfirmText">Delete this exercise and all its sets?</span>
          <div class="wtEditDeleteConfirmActions">
            <button class="wtEditDeleteConfirmBtn wtEditDeleteConfirmCancel" @click="confirmDeleteExercise = false">Cancel</button>
            <button class="wtEditDeleteConfirmBtn wtEditDeleteConfirmDanger" @click="undoDeleteExercise(store.exercises.find(e => e.id === editTarget)!); editTarget = null">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Exercise Picker (timeline + Log Set) -->
  <Teleport to="body">
    <div v-if="timelineLogPicking" class="repMaxOverlay" @click.self="timelineLogPicking = false" @keydown.escape="timelineLogPicking = false">
      <div class="repMaxModal" role="dialog" aria-modal="true">
        <h2>Choose Exercise</h2>
        <div class="wtExPickerList">
          <button
            v-for="ex in store.exercises"
            :key="ex.id"
            class="wtExPickerRow"
            @click="pickExerciseForLog(ex.id)"
          >
            <span class="wtExPickerName">{{ ex.name }}</span>
            <span class="wtChevron">›</span>
          </button>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="timelineLogPicking = false">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Tag Manager Modal -->
  <Teleport to="body">
    <div v-if="tagManagerOpen" class="repMaxOverlay" @click.self="tagManagerOpen = false" @keydown.escape="tagManagerOpen = false">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <h2 id="tag-manager-title">Manage Tags</h2>
        <p v-if="store.allTags.length === 0 && !tagManagerAdding" class="wtEmpty" style="margin: var(--space-4) 0">No tags yet. Tap + to create one.</p>
        <ul class="wtTagManagerList">
          <li v-for="tag in store.allTags" :key="tag" class="wtTagManagerItemWrap">
            <div class="wtTagManagerItem">
              <template v-if="renamingTag === tag">
                <input
                  v-model.trim="renameTagValue"
                  type="text"
                  autocomplete="off"
                  maxlength="30"
                  class="repMaxInput wtTagManagerInput"
                  @keyup.enter="confirmRenameTag"
                  @keyup.escape="renamingTag = null"
                  ref="renameTagInputEl"
                />
                <button class="wtTagManagerSaveBtn" @click="confirmRenameTag" :disabled="!renameTagValue" aria-label="Save tag name">✓</button>
                <button class="wtTagManagerCancelBtn" @click="renamingTag = null" aria-label="Cancel rename">✕</button>
              </template>
              <template v-else>
                <button class="wtTagManagerExpandBtn" @click="toggleTagExpand(tag)" :aria-expanded="expandedTag === tag" :aria-label="'Show exercises for ' + tag">
                  <span class="wtTagManagerExpandIcon" :class="{ expanded: expandedTag === tag }">›</span>
                </button>
                <span class="wtTagManagerLabel" @click="toggleTagExpand(tag)" role="button">{{ tag }}</span>
                <span class="wtTagManagerCount">{{ tagExerciseCount(tag) }}</span>
                <button class="wtTagManagerEditBtn" @click="startRenameTag(tag)" aria-label="Rename tag">✎</button>
                <button class="wtTagManagerDeleteBtn" @click="confirmDeleteTag(tag)" aria-label="Delete tag">✕</button>
              </template>
            </div>
            <ul v-if="expandedTag === tag" class="wtTagExerciseList">
              <li v-for="exercise in store.exercises" :key="exercise.id">
                <button class="wtTagExerciseRow" @click="toggleExerciseTag(exercise.id, tag)">
                  <span class="wtTagExerciseRowName">{{ exercise.name }}</span>
                  <svg v-if="exercise.tags.includes(tag)" class="wtTagExerciseCheck" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <div v-if="tagManagerAdding" class="wtTagManagerAddRow">
          <input
            v-model.trim="tagManagerNewName"
            type="text"
            autocomplete="off"
            placeholder="Tag name"
            maxlength="30"
            class="repMaxInput"
            ref="tagManagerInputEl"
            @keyup.enter="confirmTagManagerAdd"
            @keyup.escape="cancelTagManagerAdd"
          />
          <button class="wtTagAddBtn" @mousedown.prevent @click="confirmTagManagerAdd" :disabled="!tagManagerNewName" aria-label="Create tag">✓</button>
        </div>
        <div class="repMaxActions">
          <button v-if="!tagManagerAdding" class="repMaxBtn repMaxBtnCalc" @click="startTagManagerAdd">+ New Tag</button>
          <button class="repMaxBtn repMaxBtnClose" @click="tagManagerOpen = false">Done</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Rest timer bar -->
  <button
    v-if="restTimerEnabled && !showModal"
    class="wtRestBar"
    :class="{ wtRestBarActive: timerActive && !showModal, wtRestBarUrgent: timerUrgent && timerActive && !showModal }"
    @click="openRestTimer"
  >
    <template v-if="timerActive">
      <div class="wtRestBarProgress" :style="{ width: (timerProgress * 100) + '%' }"></div>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarTime">{{ timerDisplay }}</span>
      <span class="wtRestBarLabel">remaining</span>
    </template>
    <template v-else>
      <svg class="wtRestBarIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="wtRestBarLabel">Start Rest Timer</span>
    </template>
  </button>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onUnmounted } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import type { Exercise, WorkoutSet, PlateCountMode } from '../stores/workout'

interface PREntry extends WorkoutSet {
  daysSince: number | null
  e1rmDelta: number | null
}
import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'
import { useUndoToast } from '../composables/useUndoToast'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import { useFocusTrap } from '../composables/useFocusTrap'
import { useHaptics } from '../composables/useHaptics'
import { useProgressionStore, showXPToast, showUnlockCelebration } from '../stores/progression'
import { platesToWeight, weightToPlates, formatPlates, LBS_PLATES, KG_PLATES } from '../lib/plateCalculator'
import { THEMES } from '../composables/useTheme'
import { calculateSetXP, calculateBest1RM, applyStreakMultiplier, checkRepPR, isExerciseEstablished, XP_CONFIG } from '../lib/xp'
import { logXPEvent } from '../lib/xpInstrumentation'
import ExerciseGraph from './ExerciseGraph.vue'

const store = useWorkoutStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { currentTheme, restTimerEnabled, restTimerAutoStart, weightUnit, displayWeight, toLbs } = useTheme()
const { impactLight, notifySuccess } = useHaptics()

function computeAndLogXP(exerciseId: string, setId: string, estimated1RM: number, weight: number, reps: number) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (!exercise) return

  // Best 1RM from existing sets (before this set was added, it's already in the array)
  const otherSets = exercise.sets.filter(s => s.id !== setId)
  const rawBest1RM = calculateBest1RM(otherSets)

  // Suppress PR detection for immature exercises (all sets from same day)
  const isEstablished = isExerciseEstablished(otherSets, date.value || todayISO())
  const best1RM = isEstablished ? rawBest1RM : null

  // Rep PR only awards bonus when NOT already in PR/Tied PR zone
  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const isRepPR = isEstablished && !isPRZone && checkRepPR(weight, reps, otherSets)

  const setIndex = exercise.sets.length - 1
  const baseXP = calculateSetXP({
    setEstimated1RM: estimated1RM,
    exerciseBest1RM: best1RM,
    setIndex: best1RM === null ? setIndex : 0,
    isRepPR,
  })

  // Determine zone for storage, instrumentation, and display
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
  // If no history entry for current week, apply currentMultiplier directly
  if (xp === baseXP && mult > 1) {
    xp = Math.round(baseXP * mult)
  }
  const setMeta = { theme: currentTheme.value, epoch: progressionStore.epoch, zone, isPR, isRepPR }

  // Always record metadata (shadow ledger — enables per-theme stats even without progression)
  progressionStore.recordSetXP(setId, xp, setMeta)

  // Only credit XP and trigger progression effects when enabled
  if (progressionStore.progressionEnabled) {
    const wasTrialPeriod = !progressionStore.starterConfirmed
    progressionStore.creditSetXP(setId, xp)

    // Notify when starter locks in on first set
    if (wasTrialPeriod && progressionStore.starterConfirmed) {
      const starterLabel = THEMES.find(t => t.id === progressionStore.starterTheme)?.label
      if (starterLabel) {
        setTimeout(() => showXPToast(
          `${starterLabel} locked in as your starter`,
          progressionStore.progressPercent,
          progressionStore.totalXP,
          progressionStore.nextUnlockThreshold
        ), 4500)
      }
    }
    const newUnlocks = progressionStore.checkUnlocks()
    if (newUnlocks.length > 0) {
      const theme = THEMES.find(t => t.id === newUnlocks[0])
      if (theme) {
        setTimeout(() => {
          showUnlockCelebration(theme.id, theme.label)
          notifySuccess()
        }, progressionStore.showProgression ? 1500 : 500)
      }
    }
  }

  logXPEvent({
    userId: progressionStore._userId,
    setId,
    exerciseId,
    setDate: new Date().toISOString(),
    baseXP,
    streakMultiplier: mult,
    finalXP: xp,
    isPR,
    isTie,
    isRepPR,
    zone,
    activeTheme: currentTheme.value,
    epoch: progressionStore.epoch,
  })

  if (progressionStore.progressionEnabled && progressionStore.showProgression) {
    const parts: string[] = []

    if (best1RM === null) {
      parts.push('New Exercise')
    } else {
      const ratio = estimated1RM / best1RM
      if (ratio > 1.0) parts.push(`PR! (${XP_CONFIG.prMultiplier}x)`)
      else if (ratio === 1.0) parts.push(`Tied PR (${XP_CONFIG.tieMultiplier}x)`)
      else if (ratio < XP_CONFIG.warmupThreshold) parts.push('Warmup')
      else parts.push(`${Math.round(ratio * 100)}% of best`)
    }
    if (isRepPR) parts.push(`Rep PR (${XP_CONFIG.repPRMultiplier}x)`)
    if (mult > 1) parts.push(`${mult}x streak`)
    parts.push(`${xp} XP`)

    showXPToast(parts.join(' · '), progressionStore.progressPercent, progressionStore.totalXP, progressionStore.nextUnlockThreshold)
  }
}

// ── View toggle ──────────────────────────────────────────────────
const listView = ref<'exercises' | 'timeline'>(
  (localStorage.getItem('wt-list-view') as 'exercises' | 'timeline') || 'exercises'
)
watch(listView, v => localStorage.setItem('wt-list-view', v))

// ── Timeline view ───────────────────────────────────────────────
const timelineLimit = ref(50)

interface TimelineEntry {
  exerciseId: string
  exerciseName: string
  set: { id: string; date: string; weight: number; reps: number; estimated1RM: number }
}

const timelineSets = computed((): TimelineEntry[] => {
  const entries: TimelineEntry[] = []
  for (const ex of store.exercises) {
    for (const s of ex.sets) {
      entries.push({ exerciseId: ex.id, exerciseName: ex.name, set: s })
    }
  }
  return entries.sort((a, b) => b.set.date.localeCompare(a.set.date))
})

const visibleTimelineGroups = computed(() => {
  const limited = timelineSets.value.slice(0, timelineLimit.value)
  const groups: { key: string; label: string; sets: TimelineEntry[] }[] = []
  for (const entry of limited) {
    const k = toLocalDateKey(entry.set.date)
    const last = groups[groups.length - 1]
    if (last && last.key === k) {
      last.sets.push(entry)
    } else {
      groups.push({ key: k, label: formatDate(entry.set.date), sets: [entry] })
    }
  }
  return groups
})

// ── Search & tag filtering ──────────────────────────────────────
const searchQuery = ref('')
const activeTagFilters = ref<string[]>([])

function toggleTagFilter(tag: string) {
  const idx = activeTagFilters.value.indexOf(tag)
  if (idx >= 0) {
    activeTagFilters.value = activeTagFilters.value.filter(t => t !== tag)
  } else {
    activeTagFilters.value = [...activeTagFilters.value, tag]
  }
}

const filteredExercises = computed(() => {
  let result = store.exercises
  // Text search
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    result = result.filter(e => e.name.toLowerCase().includes(q))
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

// Remove stale tags from active filters
watch(() => store.allTags, (tags) => {
  activeTagFilters.value = activeTagFilters.value.filter(t => tags.includes(t))
})

// ── Card state ────────────────────────────────────────────────────
const showAllSets = ref(new Set<string>())
const SET_LIMIT = 10

// Exercise detail modal
const detailExercise = computed((): Exercise | null =>
  detailExerciseId.value ? store.exercises.find(e => e.id === detailExerciseId.value) ?? null : null
)
const detailExerciseId = ref<string | null>(null)

// Earliest date the detail exercise hit its PR — only that date gets trophies
const detailPRDate = computed(() => {
  const ex = detailExercise.value
  if (!ex) return ''
  const pr = store.getExercisePR(ex.id)
  if (!pr) return ''
  let earliest = ''
  for (const set of ex.sets) {
    if (set.estimated1RM === pr) {
      const day = set.date.slice(0, 10)
      if (!earliest || day < earliest) earliest = day
    }
  }
  return earliest
})

const detailTab = ref<'sets' | 'prs'>('sets')

// ── Swipe-to-dismiss for detail modal ───────────────────────────
const detailSwipe = useSwipeToDismiss({
  threshold: 100,
  onDismiss: () => { detailExerciseId.value = null },
})

const detailFocus = useFocusTrap()
const logModalFocus = useFocusTrap()
const editExerciseFocus = useFocusTrap()
const tagManagerFocus = useFocusTrap()

const detailSheetEl = ref<HTMLElement | null>(null)
const detailHandleEl = ref<HTMLElement | null>(null)

watch(detailExerciseId, async (id) => {
  if (id) {
    await nextTick()
    if (detailSheetEl.value && detailHandleEl.value) {
      detailSwipe.attach(detailSheetEl.value, detailHandleEl.value)
      detailFocus.activate(detailSheetEl.value)
    }
  } else {
    detailSwipe.detach()
    detailFocus.deactivate()
  }
})

function openDetailModal(id: string) {
  detailExerciseId.value = id
  activeSetId.value = null
  detailTab.value = 'sets'
}

const prHistory = computed((): PREntry[] => {
  if (!detailExercise.value) return []
  const sets = [...detailExercise.value.sets].sort((a, b) => a.date.localeCompare(b.date))
  // Collect all new maxes
  const raw: WorkoutSet[] = []
  let maxSoFar = 0
  for (const set of sets) {
    if (set.estimated1RM > maxSoFar) {
      maxSoFar = set.estimated1RM
      raw.push({ ...set })
    }
  }
  // Keep only the best PR per day
  const byDay: Record<string, WorkoutSet> = {}
  for (const pr of raw) {
    const day = pr.date.slice(0, 10)
    if (!byDay[day] || pr.estimated1RM > byDay[day].estimated1RM) {
      byDay[day] = pr
    }
  }
  const sorted = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
  // Add daysSince and e1rmDelta
  const prs: PREntry[] = sorted.map((pr, i) => ({
    ...pr,
    daysSince: i > 0
      ? Math.round((new Date(pr.date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86400000)
      : null,
    e1rmDelta: i > 0
      ? +(pr.estimated1RM - sorted[i - 1].estimated1RM).toFixed(1)
      : null,
  }))
  return prs.reverse()
})

// ── Drag-to-reorder ─────────────────────────────────────────────
const exerciseListEl = ref<HTMLElement | null>(null)
const dragState = reactive({ dragging: false, fromIndex: -1, overIndex: -1 })

function getItemIndexFromPoint(clientY: number): number {
  const list = exerciseListEl.value
  if (!list) return -1
  const items = list.querySelectorAll('.wtExerciseItem')
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (clientY >= rect.top && clientY <= rect.bottom) return i
    // If between items, snap to closest
    if (clientY < rect.top) return Math.max(0, i)
  }
  return items.length - 1
}

function onDragStart(index: number, _event: MouseEvent | TouchEvent) {
  dragState.dragging = true
  dragState.fromIndex = index
  dragState.overIndex = index

  const onMove = (e: MouseEvent | TouchEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const idx = getItemIndexFromPoint(clientY)
    if (idx !== -1) dragState.overIndex = idx
  }

  const onEnd = () => {
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)

    if (dragState.fromIndex !== dragState.overIndex) {
      store.reorderExercise(dragState.fromIndex, dragState.overIndex)
      logEvent('exercise_reorder')
    }

    dragState.dragging = false
    dragState.fromIndex = -1
    dragState.overIndex = -1
  }

  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { once: true })
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd, { once: true })
}

// ── Set actions (tap-to-reveal) ──────────────────────────────────
const activeSetId = ref<string | null>(null)

function toggleSetActions(setId: string) {
  activeSetId.value = activeSetId.value === setId ? null : setId
}

function toggleShowAll(id: string) {
  const next = new Set(showAllSets.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  showAllSets.value = next
}

function visibleSets(exercise: Exercise): WorkoutSet[] {
  const sorted = [...exercise.sets].sort((a, b) => b.date.localeCompare(a.date))
  return showAllSets.value.has(exercise.id) ? sorted : sorted.slice(0, SET_LIMIT)
}

function toLocalDateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const groupedSets = computed(() => {
  if (!detailExercise.value) return []
  const sets = visibleSets(detailExercise.value)
  const groups: { date: string; key: string; sets: WorkoutSet[] }[] = []
  for (const set of sets) {
    const k = toLocalDateKey(set.date)
    const last = groups[groups.length - 1]
    if (last && last.key === k) {
      last.sets.push(set)
    } else {
      groups.push({ date: set.date, key: k, sets: [set] })
    }
  }
  return groups
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Converts a stored ISO string back to the local YYYY-MM-DD for a date input
function isoToLocalDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayISO(): string {
  // Use local date components — toISOString() returns UTC which gives the
  // wrong date in US timezones after ~5pm (midnight UTC comes before midnight local).
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Log / Edit modal state ────────────────────────────────────────
const weightInputEl = ref<HTMLInputElement | null>(null)
const showModal = ref(false)

const editingSet = ref<{ exerciseId: string; setId: string } | null>(null)
const selectedExerciseId = ref('')

// ── Previous sets for quick-fill ─────────────────────────────────
const RECENT_SET_LIMIT = 5

const recentSets = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  if (!ex || ex.sets.length === 0) return []
  // Sort by date descending, skip today
  const today = todayISO()
  const prior = [...ex.sets]
    .filter(s => toLocalDateKey(s.date) !== today)
    .sort((a, b) => b.date.localeCompare(a.date))
  // Deduplicate by weight×reps, keep most recent of each
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

// ── Plate calculator state ──────────────────────────────────────
const currentPlates = ref<number[]>([])
const previousPlates = ref<number[]>([])

const plateMode = computed(() => {
  const ex = store.exercises.find(e => e.id === selectedExerciseId.value)
  return ex?.inputMode === 'plates'
})
const plateNumpadOverride = ref(false)

function adjustReps(delta: number) {
  const current = reps.value ?? 0
  const next = Math.max(1, Math.min(MAX_REPS, current + delta))
  reps.value = next
  repsStr.value = String(next)
}

function onWeightInputFocus() {
  if (plateMode.value && !plateNumpadOverride.value) {
    plateNumpadOverride.value = true
    // Force inputmode update synchronously so iOS shows keyboard from this tap
    if (weightInputEl.value) {
      weightInputEl.value.inputMode = 'decimal'
    }
  }
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
// Sync plate display when weight changes from input/chips (not from plate buttons)
watch(weightStr, () => {
  if (plateMode.value && !_plateSync) syncPlatesFromWeight()
})

const date = ref(todayISO())
// Remembers the last date the user manually set when logging, so the modal
// re-opens to that date rather than always resetting to today.
const lastLogDate = ref(todayISO())



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

// Open modal pre-targeted at a specific existing exercise
function openLogForExercise(exerciseId: string) {
  editingSet.value = null
  selectedExerciseId.value = exerciseId
  date.value = lastLogDate.value
  // Initialize plate calculator from last set if plate-loaded
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

// Open modal to edit an existing set
function openEditModal(exercise: Exercise, set: WorkoutSet) {
  editingSet.value = { exerciseId: exercise.id, setId: set.id }
  selectedExerciseId.value = exercise.id
  date.value = isoToLocalDate(set.date)
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
}

// ── Rest timer ──────────────────────────────────────────────────
const timerActive = ref(false)
const timerPaused = ref(false)
const timerSeconds = ref(0)
const restDuration = ref(parseInt(localStorage.getItem('rest-duration') ?? '90') || 90)
let timerIntervalId: ReturnType<typeof setInterval> | null = null

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

function startInterval() {
  if (timerIntervalId !== null) clearInterval(timerIntervalId)
  timerIntervalId = setInterval(() => {
    if (!timerPaused.value) {
      timerSeconds.value--
      if (warningTimes.value.includes(timerSeconds.value)) {
        playWarningBeep(timerSeconds.value)
      }
      if (timerSeconds.value <= 0) {
        playGoBeep()
        if (timerIntervalId !== null) clearInterval(timerIntervalId)
        timerIntervalId = null
        timerSeconds.value = 0
        if (!editingPresets.value) {
          onTimerComplete()
        }
      }
    }
  }, 1000)
}

function startRestTimer() {
  ensureAudioCtx()
  timerActive.value = true
  timerPaused.value = false
  timerSeconds.value = restDuration.value
  startInterval()
}

function togglePause() {
  ensureAudioCtx()
  timerPaused.value = !timerPaused.value
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
    // Don't disable the last visible preset
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
  // Play a short quiet tick to unlock iOS audio on user gesture
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

// Warning tone — pitch rises as time gets closer to zero
function playWarningBeep(secondsLeft: number) {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  try {
    const t = audioCtx.currentTime
    // Higher pitch for closer warnings: 30s→550Hz, 10s→700Hz, 5s→850Hz, 3s→1000Hz
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

// Bright double chirp — "time's up, go"
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
  const pr = store.getExercisePR(id)
  return pr > 0 && liveEstimateLbs.value > pr
})

// ── PR target suggestions (inverse Epley) ──────────────────────
// When only one field is filled, show what's needed in the other to beat the PR
const prTargetWeight = computed<number | null>(() => {
  if (isEditMode.value || !reps.value || reps.value < 1) return null
  if (weight.value && weight.value > 0) return null // both filled → show live estimate instead
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id)
  if (pr <= 0) return null
  // Account for Epley rounding: round(w * (1 + r/30)) > pr triggers at pr + 0.5
  const target = pr + 0.5
  const targetLbs = reps.value === 1 ? Math.ceil(target) : Math.ceil(target / (1 + reps.value / 30))
  return displayWeight(targetLbs)
})

// ── Live XP preview (shown when both weight and reps are filled) ──
const liveXPPreview = computed(() => {
  if (!progressionStore.progressionEnabled || !progressionStore.showProgression) return null
  if (!liveEstimateLbs.value || isEditMode.value) return null
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null

  const exercise = store.exercises.find(e => e.id === id)
  if (!exercise) return null

  const rawBest1RM = calculateBest1RM(exercise.sets)
  const estimated1RM = liveEstimateLbs.value
  const w = toLbs(weight.value!)
  const r = reps.value!

  const isEstablished = isExerciseEstablished(exercise.sets, date.value || todayISO())
  const best1RM = isEstablished ? rawBest1RM : null

  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const hasSetAtWeight = exercise.sets.some(s => s.weight === w)
  const isRepPR = isEstablished && !isPRZone && checkRepPR(w, r, exercise.sets)
  const isNewWeight = !isPRZone && !isRepPR && !hasSetAtWeight && best1RM !== null

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
})

const prTargetReps = computed<number | null>(() => {
  if (isEditMode.value || !weight.value || weight.value <= 0) return null
  if (reps.value && reps.value >= 1) return null // both filled
  const id = selectedExerciseId.value
  if (!id || id === '__new__') return null
  const pr = store.getExercisePR(id)
  if (pr <= 0) return null
  const wLbs = toLbs(weight.value)
  // Account for Epley rounding: round(w * (1 + r/30)) > pr triggers at pr + 0.5
  if (Math.round(wLbs) > pr) return 0 // any rep beats it (1RM at this weight already exceeds PR)
  const needed = Math.ceil(30 * ((pr + 0.5) / wLbs - 1))
  return needed
})

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

const MAX_WEIGHT = 2000
const MAX_REPS = 200
const hasSetData = computed(() => weight.value !== null && weight.value > 0 && weight.value <= MAX_WEIGHT && reps.value !== null && reps.value >= 1 && reps.value <= MAX_REPS)

const canSave = computed(() => {
  if (isEditMode.value) return hasSetData.value
  if (selectedExerciseId.value === '__new__') return newExerciseName.value.length > 0
  return selectedExerciseId.value !== '' && hasSetData.value
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
        const rawBest = calculateBest1RM(otherSets)
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
        const editIsRepPR = editEstablished && !editIsPRZone && checkRepPR(set.weight, set.reps, otherSets)
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
    if (hasSetData.value && weight.value !== null && reps.value !== null) {
      const wasPR = isNewPR.value
      store.logSet(exerciseId, toLbs(weight.value), reps.value, date.value)
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
      } else {
        impactLight()
      }
      if (restTimerEnabled.value && restTimerAutoStart.value) {
        startRestTimer()
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

// ── Edit exercise state (rename + tags) ──────────────────────────
const editTarget = ref<string | null>(null)
const confirmDeleteExercise = ref(false)
const editName = ref('')
const editTags = ref<string[]>([])
const newTagInput = ref('')
const editPlateMode = ref(false)
const editPlateCountMode = ref<'per-side' | 'total'>('per-side')
const editBarWeight = ref<number>(45)


function openEditExerciseModal(exercise: Exercise) {
  editTarget.value = exercise.id
  confirmDeleteExercise.value = false
  editName.value = exercise.name
  editTags.value = [...(exercise.tags || [])]
  editPlateMode.value = exercise.inputMode === 'plates'
  editPlateCountMode.value = exercise.plateCountMode || 'per-side'
  editBarWeight.value = exercise.barWeight ?? (exercise.plateCountMode === 'total' ? 0 : 45)
  newTagInput.value = ''
}

const editTagInputEl = ref<HTMLInputElement | null>(null)
const editTagAdding = ref(false)

function startEditTagAdd() {
  editTagAdding.value = true
  nextTick(() => editTagInputEl.value?.focus())
}

function addEditTag() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
  nextTick(() => editTagInputEl.value?.focus())
}

function finishEditTagAdd() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
  editTagAdding.value = false
}


function toggleEditTag(tag: string) {
  if (editTags.value.includes(tag)) {
    editTags.value = editTags.value.filter(t => t !== tag)
  } else {
    editTags.value.push(tag)
  }
}

// All known tags, including any on this exercise that might not be in allTags yet
const availableEditTags = computed(() => {
  const all = new Set([...store.allTags, ...editTags.value])
  return [...all]
})

function confirmEditExercise() {
  if (!editTarget.value || !editName.value) return
  // Auto-add any pending tag text
  const pendingTag = newTagInput.value.trim()
  if (pendingTag && !editTags.value.includes(pendingTag)) {
    editTags.value.push(pendingTag)
  }
  store.renameExercise(editTarget.value, editName.value)
  store.updateExerciseTags(editTarget.value, editTags.value)
  // Save input mode and plate settings
  store.setExerciseInputMode(editTarget.value, editPlateMode.value ? 'plates' : 'numpad')
  if (editPlateMode.value) {
    store.setExercisePlateCountMode(editTarget.value, editPlateCountMode.value)
    const ex = store.exercises.find(e => e.id === editTarget.value)
    if (ex) {
      ex.barWeight = editBarWeight.value
      store._persist()
    }
  }
  editTarget.value = null
  syncPlateWeight()
  logEvent('exercise_edit')
}

// ── Tag manager ────────────────────────────────────────────────
const tagManagerOpen = ref(false)
const renamingTag = ref<string | null>(null)
const renameTagValue = ref('')
const renameTagInputEl = ref<HTMLInputElement[] | null>(null)
const expandedTag = ref<string | null>(null)
const tagManagerAdding = ref(false)
const tagManagerNewName = ref('')
const tagManagerInputEl = ref<HTMLInputElement | null>(null)
function openTagManager() {
  tagManagerOpen.value = true
  renamingTag.value = null
  expandedTag.value = null
  tagManagerAdding.value = false
  tagManagerNewName.value = ''
}

function startTagManagerAdd() {
  tagManagerAdding.value = true
  nextTick(() => tagManagerInputEl.value?.focus())
}

function confirmTagManagerAdd() {
  const tag = tagManagerNewName.value.trim()
  if (tag && !store.allTags.includes(tag)) {
    store.addCustomTag(tag)
    expandedTag.value = tag
  }
  tagManagerNewName.value = ''
  tagManagerAdding.value = false
}

function cancelTagManagerAdd() {
  tagManagerNewName.value = ''
  tagManagerAdding.value = false
}

function toggleTagExpand(tag: string) {
  expandedTag.value = expandedTag.value === tag ? null : tag
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

function tagExerciseCount(tag: string): number {
  return store.exercises.filter(e => (e.tags || []).includes(tag)).length
}

function startRenameTag(tag: string) {
  renamingTag.value = tag
  renameTagValue.value = tag
  nextTick(() => {
    if (renameTagInputEl.value && renameTagInputEl.value.length > 0) {
      renameTagInputEl.value[0].focus()
      renameTagInputEl.value[0].select()
    }
  })
}

function confirmRenameTag() {
  if (!renamingTag.value || !renameTagValue.value) return
  store.renameTag(renamingTag.value, renameTagValue.value)
  logEvent('tag_rename')
  renamingTag.value = null
}

function confirmDeleteTag(tag: string) {
  const count = tagExerciseCount(tag)
  // Track which exercises have this tag for undo
  const affectedIds = store.exercises
    .filter(e => (e.tags || []).includes(tag))
    .map(e => e.id)
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
  } else {
    logModalFocus.deactivate()
  }
})

watch(editTarget, async (target) => {
  if (target) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="edit-exercise-title"]')
    if (el) {
      editExerciseFocus.activate(el)
      // Don't auto-focus the name input — user usually isn't renaming
      ;(document.activeElement as HTMLElement)?.blur()
    }
  } else {
    editExerciseFocus.deactivate()
  }
})

watch(tagManagerOpen, async (open) => {
  if (open) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('[aria-labelledby="tag-manager-title"]')
    if (el) tagManagerFocus.activate(el)
  } else {
    tagManagerFocus.deactivate()
  }
})

// ── Lock background scroll when any modal is open (iOS) ────────
watch(
  () => showModal.value || !!detailExerciseId.value || editTarget.value !== null || tagManagerOpen.value,
  (open) => { document.documentElement.classList.toggle('modal-open', open) },
)
onUnmounted(() => {
  stopTimer()
  document.documentElement.classList.remove('modal-open')
})
</script>
