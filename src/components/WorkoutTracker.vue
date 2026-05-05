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
        v-memo="[exercise.name, exercise.sets.length, exercise.tags, prBaselineDate, dragState.dragging && dragState.fromIndex === index, dragState.dragging && dragState.overIndex === index && dragState.fromIndex !== index, isFilteringActive]"
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
            aria-hidden="true"
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
                <span v-if="timelinePRMap[entry.set.id] === 'pr'" class="wtTimelineBadge" aria-label="Personal record">🏆</span>
                <span v-else-if="timelinePRMap[entry.set.id] === 'repPR'" class="wtTimelineBadge" aria-label="Rep personal record">🔥</span>
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
                      wtSetRowPR: set.estimated1RM === store.getExercisePR(detailExercise.id, prBaselineDate) && set.date.slice(0,10) === detailPRDate,
                      'wtSetRowActive': activeSetId === set.id,
                    }"
                    @click="toggleSetActions(set.id)"
                  >
                    <span class="wtSetDetail">{{ displayWeight(set.weight) }} {{ weightUnit }} × {{ set.reps }}</span>
                    <span class="wtSet1RM">
                      ~{{ displayWeight(set.estimated1RM) }} {{ weightUnit }}
                      <span v-if="set.estimated1RM === store.getExercisePR(detailExercise.id, prBaselineDate) && set.date.slice(0,10) === detailPRDate" class="wtSetPR">🏆</span>
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

          <!--
            PR Targets card per screens/07-pr-targets-expanded.png. Always
            visible when the exercise has an established PR. Header is
            tappable to expand/collapse the scrollable list. The row
            matching the user's current reps value is highlighted in
            accent so they can see at a glance "this is the weight to
            hit at the rep count you've already chosen."
          -->
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
                aria-label="New tag name"
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
                  <input
                    v-if="editBarWeightEditing"
                    ref="editBarWeightInputEl"
                    :value="editBarWeight"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    class="iosStepperInput"
                    aria-label="Starting weight"
                    @focus="($event.target as HTMLInputElement)?.select(); scrollInputAboveKeyboard($event.target as HTMLElement)"
                    @blur="editBarWeight = Math.max(0, Math.min(MAX_WEIGHT, Math.round(Number(($event.target as HTMLInputElement).value) || 0))); editBarWeightEditing = false"
                  />
                  <button v-else class="iosStepperValue iosStepperValueTappable" @click="editBarWeightEditing = true; nextTick(() => editBarWeightInputEl?.focus())">{{ editBarWeight }} {{ weightUnit }}</button>
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
          <button
            class="wtExPickerRow wtExPickerNew"
            @click="pickNewExerciseFromPicker"
          >
            <span class="wtExPickerName">+ New exercise</span>
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
                  aria-label="Rename tag"
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
                <span class="wtTagManagerLabel" @click="toggleTagExpand(tag)" role="button" tabindex="0" @keydown.enter="toggleTagExpand(tag)" @keydown.space.prevent="toggleTagExpand(tag)">{{ tag }}</span>
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
            aria-label="New tag name"
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

  <Teleport to="body">
    <WorkoutCompleteView
      v-if="workoutCompleteDate"
      :raw-date="workoutCompleteDate"
      @close="workoutCompleteDate = null"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onUnmounted, defineAsyncComponent } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { toLocalDateKey } from '../lib/sessionSummary'

const WorkoutCompleteView = defineAsyncComponent(() => import('./WorkoutCompleteView.vue'))
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
import { usePRBaseline } from '../composables/usePRBaseline'
import { usePRBurst } from '../composables/usePRBurst'
import { useProgressionStore, showXPToast, showUnlockCelebration } from '../stores/progression'
import { platesToWeight, weightToPlates, LBS_PLATES, KG_PLATES } from '../lib/plateCalculator'
import { THEMES } from '../composables/useTheme'
import { calculateSetXP, calculateBest1RM, applyStreakMultiplier, checkRepPR, isExerciseEstablished, XP_CONFIG } from '../lib/xp'
import { logXPEvent } from '../lib/xpInstrumentation'
import { computeWeeklyGoal } from '../lib/weeklyGoal'
import ExerciseGraph from './ExerciseGraph.vue'

const store = useWorkoutStore()
const progressionStore = useProgressionStore()
const { logEvent } = useAnalytics()
const { show: showUndo } = useUndoToast()
const { currentTheme, restTimerEnabled, restTimerAutoStart, weightUnit, displayWeight, toLbs, setRestTimerEnabled } = useTheme()
const { impactLight, notifySuccess } = useHaptics()
const { prBaselineDate } = usePRBaseline()
const { presentPRBurst } = usePRBurst()

// Screen Wake Lock — keep display on during active workouts
import { useWakeLock } from '../composables/useWakeLock'
import { usePreferencesStore } from '../stores/preferences'
const _prefs = usePreferencesStore()
const wakeLockEnabled = computed(() => _prefs.experience.screenWakeLock !== false)

// Filter sets to those on/after the user-set PR baseline.
// When no baseline is set, returns sets unchanged (legacy all-time behavior).
function filterSetsSinceBaseline<T extends { date: string }>(sets: T[]): T[] {
  const baseline = prBaselineDate.value
  if (!baseline) return sets
  return sets.filter(s => s.date.slice(0, 10) >= baseline)
}

function computeAndLogXP(exerciseId: string, setId: string, estimated1RM: number, weight: number, reps: number) {
  const exercise = store.exercises.find(e => e.id === exerciseId)
  if (!exercise) return

  // Best 1RM from existing sets (before this set was added, it's already in the array)
  const otherSets = exercise.sets.filter(s => s.id !== setId)
  // Apply user-set PR baseline (falls back to rolling window when unset).
  const rawBest1RM = calculateBest1RM(otherSets, { sinceDate: prBaselineDate.value })

  // Suppress PR detection for immature exercises (all sets from same day)
  const isEstablished = isExerciseEstablished(otherSets, date.value || todayISO())
  const best1RM = isEstablished ? rawBest1RM : null

  // Rep PR only awards bonus when NOT already in PR/Tied PR zone.
  // When a baseline is set, rep PRs are also evaluated against sets since that date.
  const repPRPriorSets = filterSetsSinceBaseline(otherSets)
  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const isRepPR = isEstablished && !isPRZone && checkRepPR(weight, reps, repPRPriorSets)

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
  return entries.sort((a, b) => b.set.date.slice(0, 10).localeCompare(a.set.date.slice(0, 10)))
})

// PR badge map: for each set, determine if it's the best e1RM (weight PR)
// or the best reps at its weight (rep PR) for that exercise.
// Respects the user-set PR baseline: when set, only sets on/after baseline
// are eligible for badges AND serve as the comparison pool.
const timelinePRMap = computed((): Record<string, 'pr' | 'repPR'> => {
  const map: Record<string, 'pr' | 'repPR'> = {}
  for (const ex of store.exercises) {
    if (ex.sets.length === 0) continue
    const eligible = filterSetsSinceBaseline(ex.sets)
    if (eligible.length === 0) continue
    const best1RM = Math.max(...eligible.map(s => s.estimated1RM))
    // Weight PR: set(s) achieving the best e1RM within the baseline window
    for (const s of eligible) {
      if (s.estimated1RM === best1RM) {
        map[s.id] = 'pr'
      }
    }
    // Rep PR: best reps at each weight within the baseline window
    const bestRepsAtWeight: Record<number, number> = {}
    for (const s of eligible) {
      bestRepsAtWeight[s.weight] = Math.max(bestRepsAtWeight[s.weight] ?? 0, s.reps)
    }
    for (const s of eligible) {
      if (!map[s.id] && s.reps === bestRepsAtWeight[s.weight] && eligible.filter(o => o.weight === s.weight).length > 1) {
        map[s.id] = 'repPR'
      }
    }
  }
  return map
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

/**
 * Tag chips visible in the filter row. When the user is searching we narrow
 * the row to tags that match the query (so typing "shoulders" also filters
 * the chips), plus any currently-active tag so the user can see + toggle it
 * back off without clearing the search first.
 */
const filteredTags = computed<string[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.allTags
  return store.allTags.filter(t =>
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
  let result = store.exercises
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
const totalExercises = computed(() => store.exercises.length)

/** Sets logged on the local "today" date — drives the Finish workout affordance. */
const setsLoggedToday = computed(() => {
  const today = todayISO()
  let count = 0
  for (const ex of store.exercises) {
    for (const s of ex.sets) {
      if (toLocalDateKey(s.date) === today) count++
    }
  }
  return count
})

/** When non-null, renders the WorkoutCompleteView overlay for that date. */
const workoutCompleteDate = ref<string | null>(null)
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

/** Count of exercises carrying each tag — powers the "Push 23" suffix on tag chips. */
const tagCounts = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  for (const e of store.exercises) {
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

// ── Card state ────────────────────────────────────────────────────
const showAllSets = ref(new Set<string>())
const SET_LIMIT = 10

// Exercise detail modal
const detailExercise = computed((): Exercise | null =>
  detailExerciseId.value ? store.exercises.find(e => e.id === detailExerciseId.value) ?? null : null
)
const detailExerciseId = ref<string | null>(null)

// Earliest date the detail exercise hit its PR — only that date gets trophies.
// Respects baseline: searches only sets on/after the baseline when set.
const detailPRDate = computed(() => {
  const ex = detailExercise.value
  if (!ex) return ''
  const pr = store.getExercisePR(ex.id, prBaselineDate.value)
  if (!pr) return ''
  let earliest = ''
  for (const set of filterSetsSinceBaseline(ex.sets)) {
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

// ── Long-press to reorder ──────────────────────────────────────
// Accidental reorders were common when a touchstart on the left-edge
// drag handle fired immediately. Now the whole row is the handle, and
// it requires a ~400ms hold (matching iOS Reminders / Files / Music).
// Short taps still open the detail modal; scrolls cancel the hold.
const LONG_PRESS_MS = 400
const MOVE_TOLERANCE_PX = 8
const SUPPRESS_CLICK_MS = 50

const exerciseListEl = ref<HTMLElement | null>(null)
const dragState = reactive({ dragging: false, fromIndex: -1, overIndex: -1 })

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let pressStartX = 0
let pressStartY = 0
let suppressClickUntil = 0

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function shouldIgnorePressTarget(event: TouchEvent | MouseEvent): boolean {
  // Block reorder whenever the list is filtered (tag filter OR search).
  // Template indices are into the filtered subset, but the store splices
  // the unfiltered array — a drop under a filter corrupts unrelated rows.
  if (isFilteringActive.value) return true
  const target = event.target as HTMLElement | null
  // Never start a drag when pressing the "+ Log" affordance.
  if (target?.closest('.wtExerciseLogBtn')) return true
  return false
}

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

function onItemTouchStart(index: number, event: TouchEvent) {
  if (shouldIgnorePressTarget(event)) return
  const t = event.touches[0]
  if (!t) return
  pressStartX = t.clientX
  pressStartY = t.clientY
  clearLongPress()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    beginDrag(index)
  }, LONG_PRESS_MS)
}

function onItemTouchMove(event: TouchEvent) {
  if (!longPressTimer) return
  const t = event.touches[0]
  if (!t) return
  const dx = Math.abs(t.clientX - pressStartX)
  const dy = Math.abs(t.clientY - pressStartY)
  if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
    clearLongPress()
  }
}

function onItemTouchEnd() {
  clearLongPress()
}

function onItemMouseDown(index: number, event: MouseEvent) {
  if (shouldIgnorePressTarget(event)) return
  pressStartX = event.clientX
  pressStartY = event.clientY
  clearLongPress()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    beginDrag(index)
  }, LONG_PRESS_MS)

  const onMouseMove = (e: MouseEvent) => {
    if (!longPressTimer) {
      document.removeEventListener('mousemove', onMouseMove)
      return
    }
    if (
      Math.abs(e.clientX - pressStartX) > MOVE_TOLERANCE_PX ||
      Math.abs(e.clientY - pressStartY) > MOVE_TOLERANCE_PX
    ) {
      clearLongPress()
      document.removeEventListener('mousemove', onMouseMove)
    }
  }
  const onMouseUp = () => {
    clearLongPress()
    document.removeEventListener('mousemove', onMouseMove)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp, { once: true })
}

function onItemClickCapture(event: MouseEvent) {
  if (performance.now() < suppressClickUntil) {
    event.stopPropagation()
    event.preventDefault()
  }
}

function beginDrag(index: number) {
  // Haptic confirms pickup — Capacitor Haptics on native, Vibration API on web.
  impactLight()
  dragState.dragging = true
  dragState.fromIndex = index
  dragState.overIndex = index

  const onMove = (e: MouseEvent | TouchEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const idx = getItemIndexFromPoint(clientY)
    if (idx !== -1) dragState.overIndex = idx
    // Block page scroll while the user is dragging.
    if (e.cancelable) e.preventDefault()
  }

  const onEnd = () => {
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onEnd)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)

    if (dragState.fromIndex !== dragState.overIndex) {
      store.reorderExercise(dragState.fromIndex, dragState.overIndex)
      logEvent('exercise_reorder')
    }

    dragState.dragging = false
    dragState.fromIndex = -1
    dragState.overIndex = -1
    // iOS synthesizes a click on touchend — suppress the stale click.
    suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS
  }

  // Non-passive so the move handler can preventDefault page scroll.
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd, { once: true })
  document.addEventListener('touchcancel', onEnd, { once: true })
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
  const sorted = [...exercise.sets].sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)))
  return showAllSets.value.has(exercise.id) ? sorted : sorted.slice(0, SET_LIMIT)
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
  return formatDate(iso)
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
const prTableExpanded = ref(false)
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
// Sync plate display when weight changes from input/chips (not from plate buttons)
watch(weightStr, () => {
  if (plateMode.value && !_plateSync) syncPlatesFromWeight()
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
  prTableExpanded.value = false
}

// ── Rest timer ──────────────────────────────────────────────────
const timerActive = ref(false)
const timerPaused = ref(false)
const timerSeconds = ref(0)
const timerAnnouncement = ref('')
const restDuration = ref(parseInt(localStorage.getItem('rest-duration') ?? '90') || 90)
let timerIntervalId: ReturnType<typeof setInterval> | null = null
// Timestamp-based drift correction: store when the timer ends and
// how many seconds remained when paused, so every tick recalculates
// from wall-clock time instead of decrementing a counter.
let timerEndTime = 0        // Date.now() ms when timer should reach 0
let pausedRemaining = 0     // seconds left when paused
let lastWarnedAt = -1       // last warning second we fired (avoid duplicate beeps)

// Keep screen awake while the rest timer is running or the log-set modal is open
const wakeLockNeeded = computed(() => timerActive.value || showModal.value)
useWakeLock(wakeLockNeeded, wakeLockEnabled)

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
      // Fire warnings for any thresholds we crossed (handles skipped seconds)
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
        if (!editingPresets.value) {
          onTimerComplete()
        }
      }
    }
  }, 250)
}

function startRestTimer() {
  ensureAudioCtx()
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
    // Pausing: snapshot remaining seconds
    pausedRemaining = Math.max(Math.ceil((timerEndTime - Date.now()) / 1000), 0)
    timerPaused.value = true
  } else {
    // Resuming: recalculate end time from snapshot
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
const liveXPPreview = computed(() => {
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
  const hasSetAtWeight = repPRPriorSets.some(s => s.weight === w)
  const isRepPR = isEstablished && !isPRZone && checkRepPR(w, r, repPRPriorSets)
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

// ── PR targets table (all weight/rep combos to beat PR) ─────────
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
  // Smallest total weight increment: smallest plate × 2 (per-side) or × 1 (total)
  const smallestIncrement = denoms[denoms.length - 1] * (isPerSide.value ? 2 : 1)
  const rows: PRTargetRow[] = []

  for (let r = 1; r <= 20; r++) {
    const rawLbs = r === 1 ? Math.ceil(target) : Math.ceil(target / (1 + r / 30))
    // Round up to nearest achievable weight (5 lb increments for lbs, 2.5 kg for kg)
    let finalLbs: number
    if (isPlate) {
      // Plate mode: round up to nearest plate increment above bar weight
      const plateWeight = rawLbs - barWt
      if (plateWeight <= 0) {
        finalLbs = barWt
      } else {
        const roundedPlateWeight = Math.ceil(plateWeight / smallestIncrement) * smallestIncrement
        finalLbs = barWt + roundedPlateWeight
      }
    } else if (weightUnit.value === 'kg') {
      // Numpad kg mode: round in kg space, convert back to lbs
      const rawKg = rawLbs * 0.453592
      const roundedKg = Math.ceil(rawKg / 2.5) * 2.5
      finalLbs = Math.round(roundedKg / 0.453592)
    } else {
      // Numpad lbs mode: round to nearest 5 lbs
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

/** Shrink modal to fit above iOS keyboard, then scroll input into view */
function scrollInputAboveKeyboard(el: HTMLElement) {
  setTimeout(() => {
    const modal = el.closest('.repMaxModal') as HTMLElement | null
    if (!modal) return
    const vv = window.visualViewport
    if (!vv) return
    // Shrink modal so it fits within the visible viewport above the keyboard
    const availableHeight = vv.height - 96
    modal.style.maxHeight = `${availableHeight}px`
    // Scroll the input into view within the now-scrollable modal
    nextTick(() => {
      const inputRect = el.getBoundingClientRect()
      const visibleBottom = vv.offsetTop + vv.height
      if (inputRect.bottom > visibleBottom - 16) {
        modal.scrollTop += inputRect.bottom - visibleBottom + 60
      }
    })
    // Restore max-height when keyboard dismisses
    const restore = () => {
      modal.style.maxHeight = ''
      vv.removeEventListener('resize', restore)
    }
    vv.addEventListener('resize', restore)
  }, 400)
}
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
      // Capture the pre-log baseline PR so the burst can show old → new e1RM.
      const oldE1RM = store.getExercisePR(exerciseId, prBaselineDate.value)
      // Snapshot PR count before logging so we can detect the user's very first PR.
      const prCountBefore = wasPR ? progressionStore.totalPRCount : 0
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
        // Full-bleed PR celebration (respects the PR baseline via oldE1RM,
        // and the prCelebrations opt-out inside presentPRBurst).
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
const editBarWeightEditing = ref(false)
const editBarWeightInputEl = ref<HTMLInputElement | null>(null)


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

// Exposed so the app's top-bar "+" button can trigger quick-log without
// duplicating the exercise-picker state in App.vue. openNewExerciseModal is
// also exposed for unit tests that previously opened the new-exercise
// dialog via the in-card "+ New Exercise" button (retired after the
// 03-workouts.png restyle).
defineExpose({ openTimelineLogModal, openNewExerciseModal })
</script>
