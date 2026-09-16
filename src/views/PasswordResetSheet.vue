<template>
  <Teleport to="body">
    <div
      class="repMaxOverlay passwordResetOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passwordResetTitle"
      aria-describedby="passwordResetSub"
      @click.self="skip"
    >
      <div class="repMaxModal passwordResetModal">
        <h2 id="passwordResetTitle" class="passwordResetTitle">Set a new password</h2>
        <p id="passwordResetSub" class="passwordResetSub">
          You opened a password reset link. Choose a new password for <strong>{{ email }}</strong>.
        </p>
        <form class="passwordResetForm" @submit.prevent="submit">
          <input
            v-model="password"
            type="password"
            class="passwordResetInput"
            placeholder="New password"
            aria-label="New password"
            autocomplete="new-password"
            minlength="6"
            :aria-invalid="error ? true : undefined"
            :aria-describedby="error ? 'passwordResetError' : undefined"
            required
          />
          <p v-if="error" id="passwordResetError" class="passwordResetError" role="alert">{{ error }}</p>
          <button type="submit" class="passwordResetBtn passwordResetPrimary" :disabled="busy">
            {{ busy ? '...' : 'Update password' }}
          </button>
          <button type="button" class="passwordResetBtn" @click="skip">Not now</button>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Landing for an emailed password-reset LINK on the web (#1430): supabase-js
// exchanged the link's code, fired PASSWORD_RECOVERY, and the session is real —
// the only thing left is to choose the password, which is why "Not now" is a
// legitimate exit. The native app never reaches this sheet; it resets by the
// emailed code on the auth screen instead (see useAuth.confirmPasswordReset).
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useModal } from '../composables/useModal'

const emit = defineEmits<{ (e: 'close'): void }>()

const { user, updatePassword, clearPasswordRecovery } = useAuth()

// Centered modal; useModal owns the scroll lock, the focus trap and Escape (#831).
const { open: activateModal, close: deactivateModal } = useModal({
  selector: '.passwordResetModal',
  focusContainer: true,
  onEscape: skip,
})

const email = computed(() => user.value?.email || 'your account')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  const result = await updatePassword(password.value)
  busy.value = false
  if (result.error) {
    error.value = result.error.message
    return
  }
  emit('close')
}

function skip() {
  clearPasswordRecovery()
  emit('close')
}

onMounted(() => activateModal())
onUnmounted(() => deactivateModal())
</script>

<style scoped>
.passwordResetModal {
  max-width: 360px;
  padding: 24px;
}

.passwordResetTitle {
  margin: 0 0 8px;
  font-size: var(--font-title3);
  font-weight: 700;
  color: var(--text-primary);
}

.passwordResetSub {
  margin: 0 0 16px;
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  line-height: 1.4;
}

.passwordResetSub strong {
  color: var(--text-primary);
  font-weight: 600;
}

.passwordResetForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.passwordResetInput {
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  font-size: var(--font-callout);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  outline: none;
}

.passwordResetInput:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.passwordResetError {
  margin: 0;
  font-size: var(--font-footnote);
  color: var(--danger);
}

.passwordResetBtn {
  min-height: 44px;
  padding: 12px 16px;
  font-size: var(--font-subhead);
  font-weight: 600;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
}

.passwordResetPrimary {
  color: var(--bg-primary);
  background: var(--text-primary);
  border-color: var(--text-primary);
}

.passwordResetBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
