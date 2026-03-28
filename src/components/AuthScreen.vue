<template>
  <div class="authScreen">
    <div class="authCard">
      <div class="authLogo">Lift</div>
      <p class="authTagline">Track your sets, monitor progress, hit PRs.</p>

      <div class="authProviders">
        <button class="authProviderBtn authGoogle" @click="handleLogin('google')">
          <svg class="authProviderIcon" viewBox="0 0 24 24" width="18" height="18">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

      </div>

      <p v-if="error" class="authError">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const { signInWithProvider } = useAuth()
const error = ref('')

async function handleLogin(provider) {
  error.value = ''
  const { error: err } = await signInWithProvider(provider)
  if (err) error.value = err.message
}
</script>

<style scoped>
.authScreen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80svh;
  padding: 20px;
}

.authCard {
  width: 100%;
  max-width: 360px;
  text-align: center;
}

.authLogo {
  font-size: 42px;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -1.5px;
  margin-bottom: 6px;
}

.authTagline {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 32px;
  line-height: 1.5;
}

.authProviders {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.authProviderBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 13px 16px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.authProviderBtn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}

.authProviderBtn:active {
  opacity: 0.85;
}

.authProviderIcon {
  flex-shrink: 0;
}

.authError {
  margin-top: 16px;
  font-size: 13px;
  color: var(--danger);
  font-weight: 500;
}
</style>
