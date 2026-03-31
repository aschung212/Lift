<template>
  <!-- Main card -->
  <div class="wtCard">
    <div class="wtCardHeader">
      <h2 class="wtTitle">Exercise Tracker</h2>
      <div class="wtHeaderActions">
        <button v-if="store.exercises.length > 0" class="wtTemplateBtn" @click="openSaveTemplateModal" aria-label="Save as template">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
        <button v-if="templateStore.templates.length > 0" class="wtTemplateBtn" @click="openLoadTemplateModal" aria-label="Load template">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </button>
        <button class="wtLogBtn" @click="openNewExerciseModal">+ New Exercise</button>
      </div>
    </div>

    <!-- Tag filter -->
    <template v-if="store.allTags.length > 0">
      <div class="wtTagFilterBar">
        <button
          v-for="tag in store.allTags"
          :key="tag"
          :class="['wtTagChip', { wtTagChipActive: activeTagFilters.includes(tag) }]"
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
        >⚙</button>
      </div>
    </template>

    <p v-if="store.exercises.length === 0" class="wtEmpty">
      No exercises yet. Hit "+ New Exercise" to add your first one.
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
            <span class="wtExerciseName">{{ exercise.name }}</span>
            <span class="wtExerciseMeta">
              PR: {{ store.getExercisePR(exercise.id) ? displayWeight(store.getExercisePR(exercise.id)) : '—' }} {{ weightUnit }}
              &nbsp;·&nbsp;
              {{ exercise.sets.length }} set{{ exercise.sets.length !== 1 ? 's' : '' }}
            </span>
            <span class="wtChevron">›</span>
          </button>
          <button
            class="wtExerciseLogBtn"
            @click="openLogForExercise(exercise.id)"
            aria-label="Log a set for {{ exercise.name }}"
          >+ Log</button>
        </div>
      </li>
    </ul>
  </div>

  <!-- Exercise detail modal -->
  <Teleport to="body">
    <div v-if="detailExercise" class="repMaxOverlay" @click.self="detailExerciseId = null" @keydown.escape="detailExerciseId = null">
      <div class="wtDetailModal" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
        <div class="wtDetailHeader">
          <button class="wtDetailBack" @click="detailExerciseId = null" aria-label="Back to exercise list">‹ Back</button>
          <h2 class="wtDetailTitle" id="detail-modal-title">{{ detailExercise.name }}</h2>
          <button class="wtDetailLogBtn" @click="openLogForExercise(detailExercise.id)">+ Log</button>
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
            <ul class="wtSetList">
              <li v-if="detailExercise.sets.length === 0" class="wtSetEmpty">No sets logged yet.</li>
              <template
                v-for="(set, idx) in visibleSets(detailExercise)"
                :key="set.id"
              >
                <li
                  v-if="idx === 0 || set.date.slice(0,10) !== visibleSets(detailExercise)[idx-1].date.slice(0,10)"
                  class="wtSetDateHeader"
                >{{ formatDate(set.date) }}</li>
                <li
                  class="wtSetRow"
                  :class="{
                    wtSetRowPR: set.estimated1RM === store.getExercisePR(detailExercise.id),
                    'wtSetRowActive': activeSetId === set.id,
                  }"
                  @click="toggleSetActions(set.id)"
                >
                  <span class="wtSetDetail">{{ displayWeight(set.weight) }} {{ weightUnit }} × {{ set.reps }}</span>
                  <span class="wtSet1RM">
                    ~{{ displayWeight(set.estimated1RM) }} {{ weightUnit }}
                    <span v-if="set.estimated1RM === store.getExercisePR(detailExercise.id)" class="wtSetPR">🏆</span>
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
                </li>
              </template>
            </ul>
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

          <!-- Clear all sets -->
          <div v-if="detailExercise.sets.length > 0" class="wtClearWrap">
            <button class="wtClearBtn" @click="undoClearSets(detailExercise)">
              Clear all sets
            </button>
          </div>

          <!-- Exercise actions -->
          <div class="wtSetActions wtExActions">
            <button
              class="wtSetBtn"
              @click="openEditExerciseModal(detailExercise)"
            >Edit Exercise</button>
            <button
              class="wtSetBtn wtSetBtnDel"
              @click="undoDeleteExercise(detailExercise)"
            >Delete Exercise</button>
          </div>
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
            <button class="wtTimerEditCountdown" @click="togglePause">
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
                  >&times;</button>
                </div>
              </template>
            </div>
            <div v-if="editTab === 'rest'" class="wtTimerEditRow" style="margin-top: 8px">
              <input class="wtTimerEditInput" type="number" inputmode="numeric" v-model.number="newPresetValue" placeholder="Add seconds" min="5" max="600" @keyup.enter="addPreset" ref="presetInputEl" />
              <button class="wtTimerEditAddBtn" :disabled="!newPresetValue" @click="addPreset">Add</button>
            </div>
            <div v-else class="wtTimerEditRow" style="margin-top: 8px">
              <input class="wtTimerEditInput" type="number" inputmode="numeric" v-model.number="newWarningValue" placeholder="Add seconds" min="1" max="120" @keyup.enter="addWarningOption" />
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
          <h2 id="log-modal-title">{{ modalTitle }}</h2>

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
                  autocomplete="off"
                />
              </div>
            </label>
            <div class="repMaxLabel">
              Tags
              <div class="wtTagPicker" v-if="allNewExerciseTags.length">
                <button
                  v-for="tag in allNewExerciseTags"
                  :key="tag"
                  :class="['wtTagPickerChip', { wtTagPickerChipActive: newExerciseTags.includes(tag) }]"
                  :style="!newExerciseTags.includes(tag)
                    ? { borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                    : {}"
                  @click="toggleNewExerciseTag(tag)"
                >{{ tag }}</button>
              </div>
              <div class="wtTagAddRow">
                <input
                  v-model.trim="newExerciseTagInput"
                  type="text"
                  placeholder="New tag..."
                  class="repMaxInput"
                  ref="newTagInputEl"
                  @keyup.enter="addNewExerciseTag"
                />
                <button class="wtTagAddBtn" @mousedown.prevent @click="addNewExerciseTag" :disabled="!newExerciseTagInput">+</button>
              </div>
            </div>
          </template>

          <!-- Log for existing exercise mode: show name as subtitle -->
          <p v-else-if="isLogForExercise" class="wtModalSubtitle">{{ selectedExerciseName }}</p>

          <!-- Date: always visible -->
          <label class="repMaxLabel">
            Date
            <input
              v-model="date"
              type="date"
              :max="todayISO()"
              class="repMaxInput wtDateInput"
            />
          </label>

          <!-- Weight + Reps -->
          <div class="wtInputRow">
            <label class="repMaxLabel" style="flex:1">
              Weight ({{ weightUnit }})
              <div class="repMaxInputRow">
                <input
                  v-model.number="weight"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="any"
                  placeholder="135"
                  class="repMaxInput"
                />
              </div>
            </label>

            <label class="repMaxLabel" style="flex:1">
              Reps
              <div class="repMaxInputRow">
                <input
                  v-model.number="reps"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="30"
                  placeholder="8"
                  class="repMaxInput"
                />
              </div>
            </label>
          </div>

          <!-- Live 1RM estimate -->
          <div v-if="liveEstimate" class="repMaxResult">
            <span class="repMaxResultLabel">Estimated 1RM</span>
            <span class="repMaxResultValue">{{ liveEstimate }} {{ weightUnit }}</span>
            <span v-if="isNewPR" class="wtPrBadge">New PR! 🏆</span>
          </div>

          <div class="repMaxActions">
            <button class="repMaxBtn repMaxBtnCalc" :disabled="!canSave" @click="saveSet">
              {{ isEditMode ? 'Save Changes' : 'Save' }}
            </button>
            <button class="repMaxBtn repMaxBtnClose" @click="closeModal">Cancel</button>
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
            />
          </div>
        </label>
        <div class="repMaxLabel">
          Tags
          <div class="wtTagPicker" v-if="availableEditTags.length">
            <button
              v-for="tag in availableEditTags"
              :key="tag"
              :class="['wtTagPickerChip', { wtTagPickerChipActive: editTags.includes(tag) }]"
              :style="!editTags.includes(tag)
                ? { borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                : {}"
              @click="toggleEditTag(tag)"
            >{{ tag }}</button>
          </div>
          <div class="wtTagAddRow">
            <input
              v-model.trim="newTagInput"
              type="text"
              placeholder="New tag..."
              class="repMaxInput"
              ref="editTagInputEl"
              @keyup.enter="addEditTag"
            />
            <button class="wtTagAddBtn" @mousedown.prevent @click="addEditTag" :disabled="!newTagInput">+</button>
          </div>
        </div>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!editName" @click="confirmEditExercise">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="editTarget = null">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Tag Manager Modal -->
  <Teleport to="body">
    <div v-if="tagManagerOpen" class="repMaxOverlay" @click.self="tagManagerOpen = false" @keydown.escape="tagManagerOpen = false">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <h2 id="tag-manager-title">Manage Tags</h2>
        <p v-if="store.allTags.length === 0" class="wtEmpty" style="margin: 16px 0">No tags yet. Add tags to exercises to see them here.</p>
        <ul v-else class="wtTagManagerList">
          <li v-for="tag in store.allTags" :key="tag" class="wtTagManagerItem">
            <template v-if="renamingTag === tag">
              <input
                v-model.trim="renameTagValue"
                type="text"
                class="repMaxInput wtTagManagerInput"
                @keyup.enter="confirmRenameTag"
                @keyup.escape="renamingTag = null"
                ref="renameTagInputEl"
              />
              <button class="wtTagManagerSaveBtn" @click="confirmRenameTag" :disabled="!renameTagValue">✓</button>
              <button class="wtTagManagerCancelBtn" @click="renamingTag = null">✕</button>
            </template>
            <template v-else>
              <span class="wtTagManagerLabel">{{ tag }}</span>
              <span class="wtTagManagerCount">{{ tagExerciseCount(tag) }}</span>
              <button class="wtTagManagerEditBtn" @click="startRenameTag(tag)" aria-label="Rename tag">✎</button>
              <button class="wtTagManagerDeleteBtn" @click="confirmDeleteTag(tag)" aria-label="Delete tag">✕</button>
            </template>
          </li>
        </ul>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="tagManagerOpen = false">Done</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Save Template Modal -->
  <Teleport to="body">
    <div v-if="saveTemplateOpen" class="repMaxOverlay" @click.self="saveTemplateOpen = false" @keydown.escape="saveTemplateOpen = false">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="save-template-title">
        <h2 id="save-template-title">Save as Template</h2>
        <p class="wtModalSubtitle">Save your current {{ store.exercises.length }} exercise{{ store.exercises.length !== 1 ? 's' : '' }} as a reusable template.</p>
        <label class="repMaxLabel">
          Template name
          <input
            v-model.trim="templateName"
            type="text"
            placeholder="e.g. Push Day, Full Body"
            class="repMaxInput"
            @keyup.enter="confirmSaveTemplate"
          />
        </label>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnCalc" :disabled="!templateName" @click="confirmSaveTemplate">Save</button>
          <button class="repMaxBtn repMaxBtnClose" @click="saveTemplateOpen = false">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Load Template Modal -->
  <Teleport to="body">
    <div v-if="loadTemplateOpen" class="repMaxOverlay" @click.self="loadTemplateOpen = false" @keydown.escape="loadTemplateOpen = false">
      <div class="repMaxModal" role="dialog" aria-modal="true" aria-labelledby="load-template-title">
        <h2 id="load-template-title">Load Template</h2>
        <p class="wtModalSubtitle">Add exercises from a saved template. Existing exercises won't be duplicated.</p>
        <ul class="wtTemplateList">
          <li v-for="tpl in templateStore.sortedTemplates" :key="tpl.id" class="wtTemplateItem">
            <button class="wtTemplateItemBtn" @click="confirmLoadTemplate(tpl)">
              <span class="wtTemplateName">{{ tpl.name }}</span>
              <span class="wtTemplateMeta">{{ tpl.exercises.length }} exercise{{ tpl.exercises.length !== 1 ? 's' : '' }}</span>
            </button>
            <button class="wtTemplateDeleteBtn" @click.stop="deleteTemplate(tpl)" aria-label="Delete template">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </li>
        </ul>
        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" @click="loadTemplateOpen = false">Done</button>
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
import type { Exercise, WorkoutSet } from '../stores/workout'

interface PREntry extends WorkoutSet {
  daysSince: number | null
  e1rmDelta: number | null
}
import { useAnalytics } from '../composables/useAnalytics'
import { useTheme } from '../composables/useTheme'
import { useUndoToast } from '../composables/useUndoToast'
import { useTemplateStore } from '../stores/templates'
import type { WorkoutTemplate } from '../stores/templates'
import ExerciseGraph from './ExerciseGraph.vue'

const store = useWorkoutStore()
const templateStore = useTemplateStore()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { restTimerEnabled, restTimerAutoStart, weightUnit, displayWeight, toLbs } = useTheme()

// ── Tag filtering ────────────────────────────────────────────────
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
  if (activeTagFilters.value.length === 0) return store.exercises
  return store.exercises.filter(e => {
    const tags = e.tags || []
    return activeTagFilters.value.some(t => tags.includes(t))
  })
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

const detailTab = ref<'sets' | 'prs'>('sets')

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
  const reversed = [...exercise.sets].reverse()
  return showAllSets.value.has(exercise.id) ? reversed : reversed.slice(0, SET_LIMIT)
}

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
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// ── Log / Edit modal state ────────────────────────────────────────
const showModal = ref(false)
const editingSet = ref<{ exerciseId: string; setId: string } | null>(null)
const selectedExerciseId = ref('')
const newExerciseName = ref('')
const newExerciseTags = ref<string[]>([])
const newExerciseTagInput = ref('')
const weight = ref<number | null>(null)
const reps = ref<number | null>(null)
const date = ref(todayISO())

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
  return 'Log a Set'
})

// Open modal to log a brand-new exercise
function openNewExerciseModal() {
  editingSet.value = null
  selectedExerciseId.value = '__new__'
  newExerciseTags.value = []
  newExerciseTagInput.value = ''
  showModal.value = true
}

const newTagInputEl = ref<HTMLInputElement | null>(null)

function addNewExerciseTag() {
  const tag = newExerciseTagInput.value.trim()
  if (tag && !newExerciseTags.value.includes(tag)) {
    newExerciseTags.value.push(tag)
  }
  newExerciseTagInput.value = ''
  nextTick(() => newTagInputEl.value?.focus())
}


const allNewExerciseTags = computed(() => {
  const all = new Set([...store.allTags, ...newExerciseTags.value])
  return [...all]
})

function toggleNewExerciseTag(tag: string) {
  if (newExerciseTags.value.includes(tag)) {
    newExerciseTags.value = newExerciseTags.value.filter(t => t !== tag)
  } else {
    newExerciseTags.value.push(tag)
  }
}

// Open modal pre-targeted at a specific existing exercise
function openLogForExercise(exerciseId: string) {
  editingSet.value = null
  selectedExerciseId.value = exerciseId
  date.value = todayISO()
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
  showModal.value = false
  editingPresets.value = false
  editingSet.value = null
  selectedExerciseId.value = ''
  newExerciseName.value = ''
  newExerciseTags.value = []
  newExerciseTagInput.value = ''
  weight.value = null
  reps.value = null
  date.value = todayISO()
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
  date.value = todayISO()
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
  const pr = store.getExercisePR(id)
  return pr > 0 && liveEstimateLbs.value > pr
})

const hasSetData = computed(() => weight.value !== null && weight.value > 0 && reps.value !== null && reps.value >= 1)

const canSave = computed(() => {
  if (isEditMode.value) return hasSetData.value
  if (selectedExerciseId.value === '__new__') return newExerciseName.value.length > 0
  return selectedExerciseId.value !== '' && hasSetData.value
})

function saveSet() {
  if (!canSave.value) return
  if (isEditMode.value && editingSet.value && weight.value !== null && reps.value !== null) {
    store.updateSet(editingSet.value.exerciseId, editingSet.value.setId, toLbs(weight.value), reps.value, date.value)
    logEvent('set_edit')
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
      newExerciseName.value = ''
      newExerciseTags.value = []
      newExerciseTagInput.value = ''
      logEvent('exercise_add')
    }
    if (hasSetData.value && weight.value !== null && reps.value !== null) {
      store.logSet(exerciseId, toLbs(weight.value), reps.value, date.value)
      logEvent('set_log')
      if (restTimerEnabled.value && restTimerAutoStart.value) {
        startRestTimer()
      } else {
        closeModal()
      }
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
    () => store.syncDeleteSet(set.id),
  )
}

function undoClearSets(exercise: Exercise) {
  const savedSets = [...exercise.sets]
  const id = exercise.id
  store.clearSets(id, { sync: false })
  logEvent('sets_clear_all', { count: savedSets.length })
  showUndo(
    `${savedSets.length} set${savedSets.length !== 1 ? 's' : ''} cleared`,
    () => store.restoreSets(id, savedSets),
    () => store.syncDeleteSets(id),
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
    () => store.syncDeleteExercise(saved.id),
  )
}

// ── Edit exercise state (rename + tags) ──────────────────────────
const editTarget = ref<string | null>(null)
const editName = ref('')
const editTags = ref<string[]>([])
const newTagInput = ref('')

function openEditExerciseModal(exercise: Exercise) {
  editTarget.value = exercise.id
  editName.value = exercise.name
  editTags.value = [...(exercise.tags || [])]
  newTagInput.value = ''
}

const editTagInputEl = ref<HTMLInputElement | null>(null)

function addEditTag() {
  const tag = newTagInput.value.trim()
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag)
  }
  newTagInput.value = ''
  nextTick(() => editTagInputEl.value?.focus())
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
  editTarget.value = null
  logEvent('exercise_edit')
}

// ── Tag manager ────────────────────────────────────────────────
const tagManagerOpen = ref(false)
const renamingTag = ref<string | null>(null)
const renameTagValue = ref('')
const renameTagInputEl = ref<HTMLInputElement[] | null>(null)

function openTagManager() {
  tagManagerOpen.value = true
  renamingTag.value = null
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


// ── Templates ────────────────────────────────────────────────────
const saveTemplateOpen = ref(false)
const loadTemplateOpen = ref(false)
const templateName = ref('')

function openSaveTemplateModal() {
  templateName.value = ''
  saveTemplateOpen.value = true
}

function openLoadTemplateModal() {
  loadTemplateOpen.value = true
}

function confirmSaveTemplate() {
  if (!templateName.value) return
  const exercises = store.exercises.map(e => ({ name: e.name, tags: [...e.tags] }))
  templateStore.saveTemplate(templateName.value, exercises)
  logEvent('template_save', { count: exercises.length })
  saveTemplateOpen.value = false
}

function confirmLoadTemplate(tpl: WorkoutTemplate) {
  let added = 0
  for (const ex of tpl.exercises) {
    const id = store.addExercise(ex.name, ex.tags)
    // addExercise returns existing id if duplicate, but won't re-add
    if (id) added++
  }
  logEvent('template_load', { name: tpl.name, added })
  loadTemplateOpen.value = false
}

function deleteTemplate(tpl: WorkoutTemplate) {
  templateStore.deleteTemplate(tpl.id)
  showUndo(
    `Template "${tpl.name}" deleted`,
    () => templateStore.saveTemplate(tpl.name, tpl.exercises),
    () => {},
  )
}

onUnmounted(() => stopTimer())
</script>
