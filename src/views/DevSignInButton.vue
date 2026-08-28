<template>
  <button class="authDevBtn" @click="devSignIn">Continue as Dev</button>
</template>

<script setup lang="ts">
// Dev/e2e-only sign-in shortcut. This component is lazily imported by
// AuthScreen ONLY when the build sets VITE_E2E, so the entire "Continue as Dev"
// UI — and its chunk — is physically absent from a normal production bundle
// (LIFT-1123). A misconfigured Vercel env var that set VITE_E2E would surface
// it, which prodBundleGuard.test.ts pins against.
import { useAuth } from '../composables/useAuth'

const { devSignIn } = useAuth()
</script>

<style scoped>
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
</style>
