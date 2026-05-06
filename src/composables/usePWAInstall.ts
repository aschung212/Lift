import { ref, computed, onMounted, onUnmounted } from 'vue'

/**
 * Composable for custom PWA install prompt with contextual timing.
 *
 * Shows the install banner when:
 * - The browser fires `beforeinstallprompt` (user hasn't installed yet)
 * - User has logged at least 3 sets this session (engaged user) OR
 *   this is at least their 2nd session
 * - User hasn't dismissed the prompt in the last 7 days
 *
 * Does NOT show if:
 * - Already in standalone/PWA mode
 * - User dismissed within the last 7 days
 * - The browser didn't fire beforeinstallprompt (already installed or unsupported)
 */

const DISMISS_KEY = 'pwa-install-dismissed'
const SESSION_COUNT_KEY = 'pwa-session-count'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePWAInstall() {
  const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
  const setsLoggedThisSession = ref(0)
  const dismissed = ref(false)
  const installed = ref(false)

  // Check if already in standalone mode (PWA installed)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true

  // Track session count
  const sessionCount = parseInt(localStorage.getItem(SESSION_COUNT_KEY) || '0', 10) + 1
  localStorage.setItem(SESSION_COUNT_KEY, String(sessionCount))

  // Check if user dismissed recently
  const dismissedAt = localStorage.getItem(DISMISS_KEY)
  if (dismissedAt) {
    const elapsed = Date.now() - parseInt(dismissedAt, 10)
    if (elapsed < DISMISS_DURATION_MS) {
      dismissed.value = true
    } else {
      localStorage.removeItem(DISMISS_KEY)
    }
  }

  const canShow = computed(() =>
    !isStandalone
    && !dismissed.value
    && !installed.value
    && deferredPrompt.value !== null
    && (setsLoggedThisSession.value >= 3 || sessionCount >= 2)
  )

  function handleBeforeInstallPrompt(e: Event) {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  }

  function handleAppInstalled() {
    installed.value = true
    deferredPrompt.value = null
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleAppInstalled)
  })

  /** Call after each set is logged to increment the engagement counter. */
  function notifySetLogged() {
    setsLoggedThisSession.value++
  }

  /** Trigger the native install prompt. */
  async function promptInstall() {
    const prompt = deferredPrompt.value
    if (!prompt) return

    await prompt.prompt()
    const { outcome } = await prompt.userChoice

    if (outcome === 'accepted') {
      installed.value = true
    }
    // Either way, the prompt can only be used once
    deferredPrompt.value = null
  }

  /** User tapped the dismiss/close button on the banner. */
  function dismissPrompt() {
    dismissed.value = true
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    deferredPrompt.value = null
  }

  return {
    canShow,
    isStandalone,
    notifySetLogged,
    promptInstall,
    dismissPrompt,
  }
}
