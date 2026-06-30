<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="repMaxOverlay"
      @click.self="emit('decline')"
      @keydown.escape="emit('decline')"
    >
      <div class="repMaxModal aiConsentModal" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title">
        <h2 id="ai-consent-title">Before your first review</h2>
        <p class="aiConsentLede">
          The AI Coach sends your recent training to <strong>Anthropic</strong> (the Claude AI
          provider) to generate a weekly review. Here's exactly what leaves your device:
        </p>
        <ul class="aiConsentList">
          <li>Your set log — exercises, weights, reps and dates</li>
          <li>Personal records and how hard each set was (relative intensity)</li>
          <li>How often and consistently you train</li>
          <li v-if="!bodyweightOptOut">Your bodyweight trend</li>
        </ul>
        <p class="aiConsentFine">
          Your name, email and account ID are <strong>never</strong> sent. You can turn the
          Coach off and revoke this consent any time in Settings.
        </p>

        <div class="settingsRow aiConsentToggleRow">
          <div class="settingsLabelGroup">
            <span class="settingsLabel">Share bodyweight trend</span>
            <span class="settingsHint">Your most sensitive data — optional</span>
          </div>
          <button
            :class="['glassToggle', { on: !bodyweightOptOut }]"
            @click="bodyweightOptOut = !bodyweightOptOut"
            type="button"
            role="switch"
            :aria-checked="!bodyweightOptOut"
            :aria-label="bodyweightOptOut ? 'Share bodyweight trend' : 'Do not share bodyweight trend'"
          >
            <span class="glassToggleThumb"></span>
          </button>
        </div>

        <button class="aiConsentLink" type="button" @click="emit('view-privacy')">
          Read the full privacy policy
        </button>

        <div class="repMaxActions">
          <button class="repMaxBtn repMaxBtnClose" type="button" @click="emit('decline')">Not now</button>
          <button class="repMaxBtn repMaxBtnCalc" type="button" @click="accept">Agree &amp; continue</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap'

const props = defineProps<{
  open: boolean
  /** Current granular bodyweight opt-out (true = do NOT share). Seeds the toggle. */
  bodyweightOptOut?: boolean
}>()

const emit = defineEmits<{
  /** User affirmatively consented; payload carries the chosen bodyweight opt-out. */
  (e: 'accept', bodyweightOptOut: boolean): void
  /** User dismissed without consenting. */
  (e: 'decline'): void
  /** User asked to read the full privacy policy. */
  (e: 'view-privacy'): void
}>()

const bodyweightOptOut = ref(props.bodyweightOptOut ?? false)
const focusTrap = useFocusTrap()

watch(
  () => props.open,
  async (open) => {
    if (open) {
      // Re-seed the toggle from the latest stored preference on every open.
      bodyweightOptOut.value = props.bodyweightOptOut ?? false
      await nextTick()
      const el = document.querySelector<HTMLElement>('[aria-labelledby="ai-consent-title"]')
      if (el) focusTrap.activate(el)
    } else {
      focusTrap.deactivate()
    }
  }
)

function accept() {
  emit('accept', bodyweightOptOut.value)
}
</script>

<style scoped>
.aiConsentModal {
  max-width: 360px;
  text-align: left;
}
.aiConsentLede {
  margin: 0 0 var(--space-3);
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.45;
}
.aiConsentList {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-5);
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.5;
}
.aiConsentList li {
  margin-bottom: var(--space-1);
}
.aiConsentFine {
  margin: 0 0 var(--space-4);
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.45;
}
.aiConsentToggleRow {
  margin-bottom: var(--space-2);
}
.aiConsentLink {
  display: block;
  width: 100%;
  min-height: 44px;
  margin-bottom: var(--space-2);
  background: none;
  border: none;
  color: var(--accent);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
</style>
