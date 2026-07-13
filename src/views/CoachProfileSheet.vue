<template>
  <Teleport to="body">
    <div
      class="repMaxOverlay coachProfileOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coachProfileTitle"
      @click.self="close"
      @keydown.escape="close"
    >
      <div class="repMaxModal coachProfileModal">
        <header class="coachHeader">
          <div class="coachHeaderText">
            <h2 id="coachProfileTitle" class="coachTitle">Your Profile</h2>
            <p class="coachSub">Fill this once — every review is tailored to it.</p>
          </div>
          <button class="coachClose" @click="close" aria-label="Close profile">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div class="coachProfileBody">
          <p class="coachProfileNote">
            Sensitive fields like age and injuries are only included when you copy or
            download a review — nothing is sent automatically.
          </p>

          <!-- Basics -->
          <div class="cpGroup">
            <span class="cpGroupLabel">Sex</span>
            <div class="cpSegments" role="group" aria-label="Sex">
              <button
                v-for="opt in SEX_OPTIONS"
                :key="opt.value"
                type="button"
                :class="['cpSegment', { on: draft.sex === opt.value }]"
                :aria-pressed="draft.sex === opt.value"
                @click="draft.sex = draft.sex === opt.value ? '' : opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>

          <div class="cpRow">
            <label class="cpField">
              <span class="cpFieldLabel">Age</span>
              <input v-model.number="draft.age" class="cpInput" type="number" inputmode="numeric" min="12" max="100" placeholder="—" />
            </label>
            <label class="cpField">
              <span class="cpFieldLabel">Height</span>
              <input v-model.trim="draft.height" class="cpInput" type="text" maxlength="40" placeholder="5'6&quot; or 168 cm" />
            </label>
          </div>

          <!-- Experience -->
          <div class="cpGroup">
            <span class="cpGroupLabel">Experience</span>
            <div class="cpSegments" role="group" aria-label="Experience">
              <button
                v-for="opt in EXPERIENCE_OPTIONS"
                :key="opt.value"
                type="button"
                :class="['cpSegment', { on: draft.experience === opt.value }]"
                :aria-pressed="draft.experience === opt.value"
                @click="draft.experience = draft.experience === opt.value ? '' : opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>

          <!-- Goal -->
          <div class="cpGroup">
            <span class="cpGroupLabel">Primary goal</span>
            <div class="cpSegments cpSegmentsWrap" role="group" aria-label="Primary goal">
              <button
                v-for="opt in GOAL_OPTIONS"
                :key="opt.value"
                type="button"
                :class="['cpSegment', { on: draft.primaryGoal === opt.value }]"
                :aria-pressed="draft.primaryGoal === opt.value"
                @click="draft.primaryGoal = draft.primaryGoal === opt.value ? '' : opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>

          <label class="cpField">
            <span class="cpFieldLabel">Priority / lagging areas</span>
            <input v-model.trim="draft.prioritiesLagging" class="cpInput" type="text" maxlength="400" placeholder="e.g. side delts, hamstrings, arms" />
          </label>

          <label class="cpField">
            <span class="cpFieldLabel">Effort style</span>
            <textarea v-model.trim="draft.effortStyle" class="cpTextarea" rows="2" maxlength="400" placeholder="e.g. top set to failure + back-offs, ~1–2 RIR, add load or reps each week"></textarea>
          </label>

          <!-- Schedule -->
          <div class="cpRow">
            <label class="cpField">
              <span class="cpFieldLabel">Days / week</span>
              <input v-model.number="draft.daysPerWeek" class="cpInput" type="number" inputmode="numeric" min="1" max="14" placeholder="—" />
            </label>
            <label class="cpField">
              <span class="cpFieldLabel">Session length (min)</span>
              <input v-model.number="draft.sessionLenMin" class="cpInput" type="number" inputmode="numeric" min="10" max="360" placeholder="—" />
            </label>
          </div>

          <!-- Equipment -->
          <div class="cpGroup">
            <span class="cpGroupLabel">Equipment</span>
            <div class="cpSegments" role="group" aria-label="Equipment">
              <button
                v-for="opt in EQUIPMENT_OPTIONS"
                :key="opt.value"
                type="button"
                :class="['cpSegment', { on: draft.equipment === opt.value }]"
                :aria-pressed="draft.equipment === opt.value"
                @click="draft.equipment = draft.equipment === opt.value ? '' : opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>

          <label class="cpField">
            <span class="cpFieldLabel">Injuries / limitations</span>
            <textarea v-model.trim="draft.injuries" class="cpTextarea" rows="2" maxlength="400" placeholder="e.g. cranky left shoulder — avoid flat barbell press"></textarea>
          </label>

          <!-- Competition -->
          <div class="cpToggleRow">
            <div class="cpToggleLabel">
              <span class="cpFieldLabel">Competing</span>
              <span class="cpFieldHint">Maps gaps to judged criteria & periodization.</span>
            </div>
            <button
              :class="['glassToggle', { on: draft.competing }]"
              role="switch"
              :aria-checked="draft.competing"
              aria-label="Toggle competing"
              @click="draft.competing = !draft.competing"
            >
              <span class="glassToggleThumb"></span>
            </button>
          </div>

          <div v-if="draft.competing" class="cpCompetition">
            <div class="cpRow">
              <label class="cpField">
                <span class="cpFieldLabel">Sport</span>
                <input v-model.trim="draft.competition.sport" class="cpInput" type="text" maxlength="60" placeholder="e.g. natural bodybuilding" />
              </label>
              <label class="cpField">
                <span class="cpFieldLabel">Division</span>
                <input v-model.trim="draft.competition.division" class="cpInput" type="text" maxlength="60" placeholder="e.g. Men's Physique" />
              </label>
            </div>
            <div class="cpRow">
              <label class="cpField">
                <span class="cpFieldLabel">Timeline</span>
                <input v-model.trim="draft.competition.timeline" class="cpInput" type="text" maxlength="60" placeholder="e.g. next spring" />
              </label>
              <label class="cpField">
                <span class="cpFieldLabel">Phase</span>
                <input v-model.trim="draft.competition.phase" class="cpInput" type="text" maxlength="60" placeholder="e.g. offseason" />
              </label>
            </div>
          </div>
        </div>

        <div class="coachProfileActions">
          <button class="coachSecondaryBtn" @click="close">Cancel</button>
          <button class="coachPrimaryBtn" @click="save">Save profile</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, onMounted, onUnmounted } from 'vue'
import { useModal } from '../composables/useModal'
import { usePreferencesStore } from '../stores/preferences'
import {
  DEFAULT_COACH_PROFILE,
  type CoachProfile,
  type Sex,
  type Experience,
  type PrimaryGoal,
  type Equipment,
} from '../lib/coachProfile'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

// Top-anchored scrollable sheet so inputs stay above the iOS keyboard (settled
// pattern); useModal owns the scroll lock + focus trap (#830).
const { open: activateModal, close: deactivateModal } = useModal({
  selector: '.coachProfileModal',
  focusContainer: true,
})

const prefs = usePreferencesStore()

// Edit a local draft; commit only on Save so Cancel discards cleanly.
const draft = reactive<CoachProfile>({
  ...DEFAULT_COACH_PROFILE,
  ...prefs.coachProfile,
  competition: { ...DEFAULT_COACH_PROFILE.competition, ...prefs.coachProfile.competition },
})

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]
const EXPERIENCE_OPTIONS: { value: Experience; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]
const GOAL_OPTIONS: { value: PrimaryGoal; label: string }[] = [
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'strength', label: 'Strength' },
  { value: 'powerlifting', label: 'Powerlifting' },
  { value: 'general_fitness', label: 'General fitness' },
  { value: 'fat_loss', label: 'Fat loss' },
]
const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'full_gym', label: 'Full gym' },
  { value: 'home_gym', label: 'Home gym' },
  { value: 'minimal', label: 'Minimal' },
]

function save() {
  // The store setter sanitizes (enum/range/text caps), so raw draft values are safe.
  prefs.setCoachProfile({ ...draft, competition: { ...draft.competition } })
  emit('saved')
  emit('close')
}

function close() {
  emit('close')
}

onMounted(() => activateModal())
onUnmounted(() => deactivateModal())
</script>

<style scoped>
.coachProfileModal {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}

.coachHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.coachTitle {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: var(--font-title2);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.coachSub {
  margin: 4px 0 0;
  font-family: var(--ff);
  font-weight: 500;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
}

.coachClose {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  margin: -8px -8px 0 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.coachClose:active {
  background: var(--bg-elevated);
}

.coachProfileBody {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  margin: 16px 0;
  padding-right: 4px;
}

.coachProfileNote {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-family: var(--ff);
  font-size: var(--font-footnote);
  line-height: 1.45;
  color: var(--text-secondary);
}

.cpGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cpGroupLabel,
.cpFieldLabel {
  font-family: var(--ff);
  font-weight: 600;
  font-size: var(--font-footnote);
  color: var(--text-primary);
}

.cpFieldHint {
  font-family: var(--ff);
  font-size: var(--font-caption2, 11px);
  color: var(--text-muted);
}

.cpSegments {
  display: flex;
  gap: 8px;
}

.cpSegmentsWrap {
  flex-wrap: wrap;
}

.cpSegment {
  flex: 1 1 auto;
  min-height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-family: var(--ff);
  font-weight: 600;
  font-size: var(--font-footnote);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.cpSegment.on {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border-color: var(--accent);
}

.cpRow {
  display: flex;
  gap: 12px;
}

.cpField {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 0;
  min-width: 0;
}

.cpInput,
.cpTextarea {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--ff);
  font-size: var(--font-callout);
  box-sizing: border-box;
}

.cpTextarea {
  resize: vertical;
  line-height: 1.4;
}

.cpInput:focus,
.cpTextarea:focus {
  outline: none;
  border-color: var(--accent);
}

.cpToggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cpToggleLabel {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cpCompetition {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.coachProfileActions {
  display: flex;
  gap: 12px;
  padding-top: 4px;
}

.coachPrimaryBtn,
.coachSecondaryBtn {
  flex: 1 1 0;
  min-height: 48px;
  border-radius: 14px;
  font-family: var(--ff);
  font-weight: 700;
  font-size: var(--font-callout);
  cursor: pointer;
}

.coachPrimaryBtn {
  background: var(--accent);
  color: var(--text-on-accent, var(--bg-primary));
  border: 0;
}

.coachSecondaryBtn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
}
</style>
