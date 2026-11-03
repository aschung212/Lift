<template>
  <!-- Guided session plan (#1256): the last session in the current scope
       (gym + tags) as a day-level checklist. History is the template — no
       authoring surface. A row hands its exercise to the host, which opens the
       log sheet, where the routine lens / ghost-arm flow takes over. -->
  <section v-if="plan" class="wtSessionPlan" aria-label="Session plan">
    <button
      class="wtSessionPlanToggle"
      :aria-expanded="expanded"
      :aria-controls="LIST_ID"
      @click="toggle"
    >
      <svg class="wtSessionPlanIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
      <span class="wtSessionPlanTitleBlock">
        <span class="wtSessionPlanTitle">{{ title }}</span>
        <span class="wtSessionPlanMeta">
          <template v-if="plan.doneTotal > 0">{{ plan.doneTotal }}/{{ plan.plannedTotal }} sets · {{ dayLabel }}</template>
          <template v-else>{{ plan.items.length }} {{ plan.items.length === 1 ? 'exercise' : 'exercises' }} · {{ plan.plannedTotal }} {{ plan.plannedTotal === 1 ? 'set' : 'sets' }} · {{ dayLabel }}</template>
        </span>
      </span>
      <span class="wtSessionPlanChevron" :class="{ expanded }" aria-hidden="true">›</span>
    </button>
    <ul v-if="expanded" :id="LIST_ID" class="wtSessionPlanList">
      <li v-for="item in plan.items" :key="item.exerciseId" class="wtSessionPlanItem">
        <button
          :class="['wtSessionPlanRow', { wtSessionPlanRowDone: item.doneSets >= item.plannedSets }]"
          @click="logFromPlan(item.exerciseId)"
          :aria-label="`${item.name}, ${Math.min(item.doneSets, item.plannedSets)} of ${item.plannedSets} sets done. Log a set.`"
        >
          <span class="wtSessionPlanNameBlock">
            <span class="wtSessionPlanName">{{ item.name }}</span>
            <span class="wtSessionPlanRowMeta">
              {{ item.plannedSets }} {{ item.plannedSets === 1 ? 'set' : 'sets' }}<template v-if="item.topSet"> · top {{ planTopSetLoad(item) }} × {{ item.topSet.reps }}</template>
            </span>
          </span>
          <span v-if="item.doneSets >= item.plannedSets" class="wtSessionPlanCheck" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </span>
          <span v-else class="wtSessionPlanProgress" aria-hidden="true">{{ item.doneSets }}/{{ item.plannedSets }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Exercise } from '../stores/workout'
import { buildSessionPlan, type SessionPlanItem } from '../lib/sessionPlan'
import { formatSetLoad } from '../lib/bodyweightLoad'
import { formatShortDate, todayISO } from '../lib/dates'
import { useAnalytics } from '../composables/useAnalytics'
import { useWeightUnit } from '../composables/useWeightUnit'

const props = defineProps<{
  /**
   * The plan's scope: gym + tag filtered, in STORE order — never the recency-
   * sorted list, whose sort counts today and would reshuffle the rows as sets
   * land (#1256). The plan's live progress is read off sets the store mutates
   * in place, so the host must bind a fresh-identity array (#963).
   */
  exercises: readonly Exercise[]
  /** The active tag filters. Exactly one names the session ("Repeat last Push session"). */
  tagFilters: readonly string[]
  /**
   * Whether the checklist is open (`v-model:expanded`). The host owns it
   * because the card unmounts while a search is active and while the timeline
   * is showing, and the disclosure stays as the lifter left it across both.
   */
  expanded: boolean
}>()

const emit = defineEmits<{
  (e: 'update:expanded', expanded: boolean): void
  /** A row was tapped: open the log sheet for this exercise. */
  (e: 'log-exercise', exerciseId: string): void
}>()

const { logEvent } = useAnalytics()
const { weightUnit, displayWeight } = useWeightUnit()

const LIST_ID = 'wt-session-plan-list'

const plan = computed(() => buildSessionPlan(props.exercises, todayISO()))

/** "Repeat last Push session" when exactly one tag filter narrows the scope. */
const title = computed(() =>
  props.tagFilters.length === 1
    ? `Repeat last ${props.tagFilters[0]} session`
    : 'Repeat last session'
)

/** Reference day, labelled from its key anchored at local noon like the
 *  timeline's date headers (a bare YYYY-MM-DD in `new Date` parses as UTC and
 *  renders yesterday for US timezones). */
const dayLabel = computed(() => {
  const p = plan.value
  if (!p) return ''
  return formatShortDate(p.day + 'T12:00:00')
})

function toggle() {
  const next = !props.expanded
  emit('update:expanded', next)
  if (next) {
    logEvent('session_plan_expanded', { exercises: plan.value?.items.length ?? 0 })
  }
}

function logFromPlan(exerciseId: string) {
  logEvent('session_plan_item_tapped', {})
  emit('log-exercise', exerciseId)
}

/**
 * The row's headline — the heaviest set of the day being repeated. It is a
 * READ-BACK of a logged set, not a suggestion, so it takes the bodyweight that
 * set captured rather than today's (LIFT-1373's rule: the label describes what
 * the number came from). `SessionPlanItem.topSet` is flattened away from its
 * exercise, hence the lookup for the flag.
 */
function planTopSetLoad(item: SessionPlanItem): string {
  const top = item.topSet
  if (!top) return ''
  return formatSetLoad(
    { weight: top.weightLbs, bodyweight: top.bodyweight },
    props.exercises.find(e => e.id === item.exerciseId),
    { displayWeight, unit: weightUnit.value },
  )
}
</script>
