<template>
  <Teleport to="body">
    <div v-if="exercise" class="repMaxOverlay" @click.self="close" @keydown.escape="close">
      <div class="wtDetailModal" ref="sheetEl" :style="swipe.dragStyle()" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
        <div class="sheetDragHandle" ref="handleEl" aria-hidden="true"><span class="sheetDragPill"></span></div>
        <div class="wtDetailHeader">
          <button class="wtDetailBack" @click="close" aria-label="Back to exercise list">‹ Back</button>
          <h2 class="wtDetailTitle" id="detail-modal-title">{{ exercise.name }}</h2>
          <button class="wtDetailEditBtn" @click="$emit('open-edit-exercise', exercise)" :aria-label="`Edit ${exercise.name}`">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>

        <div class="wtDetailBody">
          <!-- Durable per-exercise note (#619): a form cue the user set in the
               edit sheet, surfaced here at the top of the detail screen. -->
          <p v-if="exercise.notes" class="wtDetailNote">{{ exercise.notes }}</p>

          <!-- Progress graph -->
          <ExerciseGraph :exercise="exercise" :mode="detailTab" />

          <!-- Detail tabs -->
          <div class="wtDetailTabs">
            <button :class="['wtDetailTab', { active: detailTab === 'sets' }]" @click="detailTab = 'sets'">
              All Sets <span class="wtDetailTabCount">{{ exercise.sets.length }}</span>
            </button>
            <button :class="['wtDetailTab', { active: detailTab === 'prs' }]" @click="detailTab = 'prs'" v-if="prHistory.length > 1">
              PRs <span class="wtDetailTabCount">{{ prHistory.length }}</span>
            </button>
          </div>

          <!-- All Sets view -->
          <template v-if="detailTab === 'sets'">
            <div v-if="exercise.sets.length > 1" class="wtTimelineControls">
              <button
                :class="['wtWarmupToggle', { wtWarmupToggleActive: hideWarmups }]"
                @click="hideWarmups = !hideWarmups"
                role="switch"
                :aria-checked="hideWarmups"
                :aria-label="hideWarmups ? 'Show warmup sets' : 'Hide warmup sets'"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M7 12h10M10 18h4"/></svg>
                <span>{{ hideWarmups ? 'Warmups hidden' : 'Hide warmups' }}</span>
              </button>
            </div>
            <div class="wtSetList">
              <p v-if="exercise.sets.length === 0" class="wtSetEmpty">No sets logged yet.</p>
              <template v-for="group in groupedSets" :key="group.key">
                <p class="wtSetDateHeader">{{ formatShortDate(group.key + 'T12:00:00') }}</p>
                <div class="wtSetCard">
                  <div
                    v-for="set in group.sets"
                    :key="set.id"
                    class="wtSetRow"
                    :class="{
                      wtSetRowPR: set.estimated1RM === detailExercisePR && setDayKey(set.date) === prDate,
                      'wtSetRowActive': activeSetId === set.id,
                    }"
                    @click="toggleSetActions(set.id)"
                  >
                    <span class="wtSetDetail">{{ displayWeight(set.weight) }} {{ weightUnit }} × {{ set.reps }}</span>
                    <span class="wtSet1RM">
                      ~{{ displayWeight(set.estimated1RM) }} {{ weightUnit }}
                      <span v-if="set.estimated1RM === detailExercisePR && setDayKey(set.date) === prDate" class="wtSetPR">🏆</span>
                    </span>
                    <div v-if="activeSetId === set.id" class="wtSetActions">
                      <button
                        class="wtSetBtn"
                        @click.stop="$emit('edit-set', exercise, set)"
                        aria-label="Edit set"
                      >Edit</button>
                      <button
                        class="wtSetBtn wtSetBtnDel"
                        @click.stop="$emit('delete-set', exercise.id, set)"
                        aria-label="Delete set"
                      >Delete</button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <div v-if="exercise.sets.length > SET_LIMIT" class="wtClearWrap">
              <button class="wtShowAllBtn" @click="toggleShowAll">
                {{ showAll ? 'Show less' : `Show all ${exercise.sets.length} sets` }}
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
                    <span>{{ formatShortDate(setDayKey(pr.date) + 'T12:00:00') }}</span>
                    <span class="wtPRCardSep">·</span>
                    <span>e1RM<InfoPopover
                      v-if="i === 0"
                      label="e1RM"
                      title="Estimated 1-rep max"
                    >Your predicted max for a single all-out rep, calculated from the weight and reps you lifted.</InfoPopover> ~{{ displayWeight(pr.estimated1RM) }} {{ weightUnit }}</span>
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
          <button class="wtDetailFooterBtn" @click="$emit('open-log-set', exercise.id)" :aria-label="`Log a set for ${exercise.name}`">+ Log Set</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useWorkoutStore } from '../stores/workout'
import { useWeightUnit } from '../composables/useWeightUnit'
import { usePRBaseline } from '../composables/usePRBaseline'
import { useSwipeToDismiss } from '../composables/useSwipeToDismiss'
import { useFocusTrap } from '../composables/useFocusTrap'
import { usePreferencesStore } from '../stores/preferences'
import { setDayKey, formatShortDate } from '../lib/dates'
import { buildWarmupSetIds } from '../lib/classifyWarmupSets'
import ExerciseGraph from '../components/ExerciseGraph.vue'
import InfoPopover from '../components/InfoPopover.vue'
import type { Exercise, WorkoutSet } from '../stores/workout'

interface PREntry extends WorkoutSet {
  daysSince: number | null
  e1rmDelta: number | null
}

const props = defineProps<{
  exerciseId: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-log-set', exerciseId: string): void
  (e: 'open-edit-exercise', exercise: Exercise): void
  (e: 'edit-set', exercise: Exercise, set: WorkoutSet): void
  (e: 'delete-set', exerciseId: string, set: WorkoutSet): void
}>()

const store = useWorkoutStore()
const prefs = usePreferencesStore()
const { weightUnit, displayWeight } = useWeightUnit()
const { prBaselineDate } = usePRBaseline()

const SET_LIMIT = 10

// ── Derived exercise ──────────────────────────────────────────────
const exercise = computed((): Exercise | null =>
  props.exerciseId ? store.exercises.find(e => e.id === props.exerciseId) ?? null : null
)

// ── Tab state ─────────────────────────────────────────────────────
const detailTab = ref<'sets' | 'prs'>('sets')

// Reset tab when exercise changes
watch(() => props.exerciseId, () => {
  detailTab.value = 'sets'
  activeSetId.value = null
  showAll.value = false
})

// ── Swipe-to-dismiss ──────────────────────────────────────────────
const sheetEl = ref<HTMLElement | null>(null)
const handleEl = ref<HTMLElement | null>(null)

const swipe = useSwipeToDismiss({
  threshold: 100,
  onDismiss: () => close(),
})

const focusTrap = useFocusTrap()

watch(() => props.exerciseId, async (id) => {
  if (id) {
    await nextTick()
    if (sheetEl.value && handleEl.value) {
      swipe.attach(sheetEl.value, handleEl.value)
      focusTrap.activate(sheetEl.value)
    }
  } else {
    swipe.detach()
    focusTrap.deactivate()
  }
})

function close() {
  emit('close')
}

// ── Warmup filtering (session-only) ──────────────────────────────
const hideWarmups = ref(false)

const warmupSetIds = computed(() => {
  if (!hideWarmups.value || !exercise.value) return new Set<string>()
  const exercises = [{ sets: exercise.value.sets.map(s => ({ id: s.id, date: s.date, estimated1RM: s.estimated1RM })) }]
  return buildWarmupSetIds(exercises, prefs.filters.warmupThreshold)
})

// ── PR baseline filtering ────────────────────────────────────────
function filterSetsSinceBaseline<T extends { date: string }>(sets: T[]): T[] {
  const baseline = prBaselineDate.value
  if (!baseline) return sets
  return sets.filter(s => setDayKey(s.date) >= baseline)
}

// Cached PR value — called once per exercise instead of twice per set row.
const detailExercisePR = computed((): number => {
  const ex = exercise.value
  if (!ex) return 0
  return store.getExercisePR(ex.id, prBaselineDate.value)
})

// Earliest date the exercise hit its PR — only that date gets trophies.
const prDate = computed(() => {
  const ex = exercise.value
  if (!ex) return ''
  const pr = detailExercisePR.value
  if (!pr) return ''
  let earliest = ''
  for (const set of filterSetsSinceBaseline(ex.sets)) {
    if (set.estimated1RM === pr) {
      const day = setDayKey(set.date)
      if (!earliest || day < earliest) earliest = day
    }
  }
  return earliest
})

// ── Set list ─────────────────────────────────────────────────────
const showAll = ref(false)
const activeSetId = ref<string | null>(null)

function toggleShowAll() {
  showAll.value = !showAll.value
}

function toggleSetActions(setId: string) {
  activeSetId.value = activeSetId.value === setId ? null : setId
}

function visibleSets(ex: Exercise): WorkoutSet[] {
  const sorted = [...ex.sets].sort((a, b) => setDayKey(b.date).localeCompare(setDayKey(a.date)))
  return showAll.value ? sorted : sorted.slice(0, SET_LIMIT)
}

const groupedSets = computed(() => {
  if (!exercise.value) return []
  let sets = visibleSets(exercise.value)
  if (hideWarmups.value) {
    const ids = warmupSetIds.value
    sets = sets.filter(s => !ids.has(s.id))
  }
  const groups: { key: string; sets: WorkoutSet[] }[] = []
  for (const set of sets) {
    const k = setDayKey(set.date)
    const last = groups[groups.length - 1]
    if (last && last.key === k) {
      last.sets.push(set)
    } else {
      groups.push({ key: k, sets: [set] })
    }
  }
  return groups
})

// ── PR history ───────────────────────────────────────────────────
const prHistory = computed((): PREntry[] => {
  if (!exercise.value) return []
  const sets = [...exercise.value.sets].sort((a, b) => a.date.localeCompare(b.date))
  const raw: WorkoutSet[] = []
  let maxSoFar = 0
  for (const set of sets) {
    if (set.estimated1RM > maxSoFar) {
      maxSoFar = set.estimated1RM
      raw.push({ ...set })
    }
  }
  const byDay: Record<string, WorkoutSet> = {}
  for (const pr of raw) {
    const day = setDayKey(pr.date)
    if (!byDay[day] || pr.estimated1RM > byDay[day].estimated1RM) {
      byDay[day] = pr
    }
  }
  const sorted = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
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

</script>
