<template>
  <Teleport to="body">
    <Transition name="undoToast">
      <div v-if="view" class="kbOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
        <div class="legalSheet" role="dialog" aria-modal="true" :aria-labelledby="'legal-title'">
          <div class="legalHeader">
            <h3 id="legal-title" class="kbTitle">{{ view === 'privacy' ? 'Privacy Policy' : 'Terms of Service' }}</h3>
            <button class="kbClose legalClose" @click="emit('close')">Close</button>
          </div>
          <div class="legalBody">
            <!-- Privacy Policy -->
            <template v-if="view === 'privacy'">
              <h4 class="legalH4">What We Collect</h4>
              <p>Lift collects only the data you explicitly enter: exercises, sets, reps, weights, and bodyweight entries. If you create an account, we store your email address for authentication.</p>
              <h4 class="legalH4">How Data Is Stored</h4>
              <p>Your workout data is stored locally on your device using browser storage (localStorage). If you sign in, data is synced to Supabase (our cloud database) so you can access it across devices. Data is transmitted over HTTPS.</p>
              <h4 class="legalH4">Analytics</h4>
              <p>We use Vercel Analytics to collect anonymous, aggregated usage data (page views, feature usage). No personally identifiable information is included in analytics events.</p>
              <h4 class="legalH4">Third-Party Services</h4>
              <ul class="legalList">
                <li><strong>Supabase</strong> — authentication and cloud data sync</li>
                <li><strong>Vercel</strong> — hosting and anonymous analytics</li>
              </ul>
              <h4 class="legalH4">Data Deletion</h4>
              <p>You can export or delete your data at any time. Use the Export feature in Settings to download your data as CSV or JSON. To delete your account and all associated data, contact us at the email below.</p>
              <h4 class="legalH4">Contact</h4>
              <p>For privacy questions, email <strong>aaronschung@gmail.com</strong>.</p>
            </template>
            <!-- Terms of Service -->
            <template v-else>
              <h4 class="legalH4">Acceptance</h4>
              <p>By using Lift, you agree to these terms. If you do not agree, please do not use the app.</p>
              <h4 class="legalH4">Description</h4>
              <p>Lift is a free workout tracking application provided as-is. We make no guarantees about uptime, data retention, or feature availability.</p>
              <h4 class="legalH4">User Responsibilities</h4>
              <p>You are responsible for maintaining the security of your account credentials. Do not share your login with others. You retain ownership of all data you enter into Lift.</p>
              <h4 class="legalH4">Acceptable Use</h4>
              <p>Do not attempt to exploit, reverse-engineer, or interfere with the operation of the app or its infrastructure.</p>
              <h4 class="legalH4">Limitation of Liability</h4>
              <p>Lift is provided "as is" without warranty of any kind. We are not liable for any data loss, injury, or damages arising from use of this app. Always consult a medical professional before starting any exercise program.</p>
              <h4 class="legalH4">Changes</h4>
              <p>We may update these terms at any time. Continued use of Lift after changes constitutes acceptance of the updated terms.</p>
              <h4 class="legalH4">Contact</h4>
              <p>For questions about these terms, email <strong>aaronschung@gmail.com</strong>.</p>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, nextTick } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap'

const props = defineProps<{
  /** Which document to show; null renders nothing (sheet closed). */
  view: 'privacy' | 'terms' | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const focusTrap = useFocusTrap()

watch(() => props.view, async (view) => {
  if (view) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.legalSheet')
    if (el) focusTrap.activate(el)
  } else {
    focusTrap.deactivate()
  }
})
</script>
