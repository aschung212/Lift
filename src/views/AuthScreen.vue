<template>
  <div class="authScreen">
    <div class="authCard">
      <img src="/icon-512.png" alt="Lift" class="authIcon" width="96" height="96" />
      <div class="authLogo">Lift</div>
      <p class="authTagline">Track your sets, monitor progress, hit PRs.</p>

      <!-- Email/password form -->
      <form class="authForm" @submit.prevent="handleEmailSubmit">
        <input
          v-model.trim="email"
          type="email"
          placeholder="Email"
          aria-label="Email"
          class="authInput"
          autocomplete="email"
          :aria-invalid="isError && !!message ? true : undefined"
          :aria-describedby="isError && !!message ? 'auth-error' : undefined"
          required
        />
        <input
          v-model="password"
          type="password"
          placeholder="Password"
          aria-label="Password"
          class="authInput"
          autocomplete="current-password"
          :minlength="isSignUp ? 6 : undefined"
          :aria-invalid="isError && !!message ? true : undefined"
          :aria-describedby="isError && !!message ? 'auth-error' : undefined"
          required
        />
        <button class="authSubmitBtn" type="submit" :disabled="submitting">
          {{ submitting ? '...' : (isSignUp ? 'Create Account' : 'Sign In') }}
        </button>
      </form>

      <button class="authModeSwitch" @click="toggleMode">
        {{ isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up" }}
      </button>

      <div class="authDivider">
        <span class="authDividerLine"></span>
        <span class="authDividerText">or</span>
        <span class="authDividerLine"></span>
      </div>

      <div class="authProviders">
        <button class="authProviderBtn authGoogle" @click="handleOAuth('google')">
          <svg class="authProviderIcon" viewBox="0 0 24 24" width="18" height="18">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
      </div>

      <button v-if="isDev" class="authDevBtn" @click="devSignIn">Continue as Dev</button>

      <p class="authTrust">Free forever — no paywall. Your data syncs privately across your devices.</p>

      <p v-if="message" :class="['authMessage', { authError: isError, authSuccess: !isError }]" :id="isError ? 'auth-error' : undefined" role="status" aria-live="polite">{{ message }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Provider } from '@supabase/supabase-js'
import { useAuth } from '../composables/useAuth'
import { useAnalytics } from '../composables/useAnalytics'

const { signInWithProvider, signInWithEmail, signUp, devSignIn } = useAuth()
const { logEvent } = useAnalytics()
// Show the dev sign-in button in local dev mode OR in CI e2e builds where
// no Supabase backend is configured. import.meta.env values are inlined at
// build time, so VITE_E2E is only true for the bundle produced by the
// e2e CI job — real Vercel deploys do not set it.
const isDev = import.meta.env.DEV || import.meta.env.VITE_E2E === 'true'

const email = ref('')
const password = ref('')
const isSignUp = ref(false)
const submitting = ref(false)
const message = ref('')
const isError = ref(false)

function toggleMode() {
  isSignUp.value = !isSignUp.value
  message.value = ''
}

async function handleEmailSubmit() {
  message.value = ''
  submitting.value = true
  const method = isSignUp.value ? 'sign_up' : 'sign_in'
  logEvent(`auth_${method}_start`, { provider: 'email' })

  if (isSignUp.value) {
    const { error, needsConfirmation } = await signUp(email.value, password.value)
    if (error) {
      isError.value = true
      message.value = error.message
      logEvent('auth_sign_up_error')
    } else if (needsConfirmation) {
      isError.value = false
      message.value = 'Check your email to confirm your account.'
      isSignUp.value = false
      logEvent('auth_sign_up_success')
    }
  } else {
    const { error } = await signInWithEmail(email.value, password.value)
    if (error) {
      isError.value = true
      message.value = error.message
      logEvent('auth_sign_in_error')
    } else {
      logEvent('auth_sign_in_success', { provider: 'email' })
    }
  }

  submitting.value = false
}

async function handleOAuth(provider: Provider) {
  message.value = ''
  logEvent('auth_sign_in_start', { provider })
  const { error } = await signInWithProvider(provider)
  if (error) {
    isError.value = true
    message.value = error.message
    logEvent('auth_sign_in_error', { provider })
  }
}
</script>

<style scoped>
.authScreen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  padding: 24px;
  background: var(--bg-primary);
}

.authCard {
  width: 100%;
  max-width: 360px;
  text-align: center;
}

.authIcon {
  width: 96px;
  height: 96px;
  border-radius: 22px;
  margin-bottom: 16px;
}

.authLogo {
  font-size: var(--font-display);
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -1.5px;
  margin-bottom: 8px;
}

.authTagline {
  font-size: var(--font-footnote);
  color: var(--text-secondary);
  margin-bottom: 32px;
  line-height: 1.5;
}

.authForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.authInput {
  width: 100%;
  padding: 12px 16px;
  min-height: 44px;
  font-size: var(--font-callout);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.authInput:focus {
  border-color: var(--accent);
}

.authInput::placeholder {
  color: var(--text-muted);
}

.authSubmitBtn {
  width: 100%;
  padding: 12px 16px;
  min-height: 44px;
  font-size: var(--font-subhead);
  font-weight: 700;
  font-family: inherit;
  color: var(--text-on-accent);
  background: var(--accent);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.authSubmitBtn:hover {
  opacity: 0.9;
}

.authSubmitBtn:active {
  opacity: 0.8;
}

.authSubmitBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.authModeSwitch {
  font-size: var(--font-footnote);
  font-family: inherit;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 12px 0;
  min-height: 44px;
  transition: color 0.12s;
}

.authModeSwitch:hover {
  color: var(--accent);
}

.authDivider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0;
}

.authDividerLine {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.authDividerText {
  font-size: var(--font-caption1);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.authProviders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.authProviderBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  min-height: 44px;
  font-size: var(--font-subhead);
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.authProviderBtn:hover {
  background: var(--bg-elevated);
  border-color: var(--accent);
}

.authProviderBtn:active {
  opacity: 0.85;
}

.authProviderIcon {
  flex-shrink: 0;
}

.authDevBtn {
  width: 100%;
  padding: 12px 16px;
  min-height: 44px;
  margin-top: 12px;
  font-size: var(--font-subhead);
  font-weight: 600;
  font-family: inherit;
  color: var(--accent);
  background: transparent;
  border: 1px dashed var(--accent);
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.authDevBtn:active {
  opacity: 0.7;
}

.authTrust {
  margin-top: 24px;
  font-size: var(--font-caption1);
  color: var(--text-secondary);
  line-height: 1.5;
}

.authMessage {
  margin-top: 16px;
  font-size: var(--font-footnote);
  font-weight: 500;
}

.authError {
  color: var(--danger);
}

.authSuccess {
  color: var(--success);
}
</style>
