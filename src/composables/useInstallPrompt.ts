import { ref, computed } from 'vue'

/**
 * Custom PWA install prompt with contextual timing.
 *
 * On Chrome/Edge: intercepts `beforeinstallprompt`, suppresses browser mini-infobar,
 * shows custom banner after user logs 3+ sets (high engagement signal).
 *
 * On iOS Safari: detects non-standalone mode, shows "Add to Home Screen" instruction
 * after the same engagement threshold.
 */

const STORAGE_KEY = 'pwa-install-prompt'
const SETS_THRESHOLD = 3

interface InstallState {
  dismissed: boolean
  installed: boolean
  setsLogged: number
}

function loadState(): InstallState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { dismissed: false, installed: false, setsLogged: 0 }
}

function saveState(s: InstallState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Module-level singleton state
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const state = ref<InstallState>(loadState())
let listenersAttached = false

function attachListeners() {
  if (listenersAttached) return
  listenersAttached = true

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
  })

  window.addEventListener('appinstalled', () => {
    state.value = { ...state.value, installed: true }
    saveState(state.value)
    deferredPrompt.value = null
  })
}

/** Reset internal state — for testing only */
export function _resetForTesting() {
  state.value = loadState()
  deferredPrompt.value = null
  listenersAttached = false
}

export function useInstallPrompt() {
  attachListeners()

  const isIOS = computed(() =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
  )

  const isStandalone = computed(() =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )

  const showBanner = computed(() => {
    if (state.value.dismissed || state.value.installed) return false
    if (isStandalone.value) return false
    if (state.value.setsLogged < SETS_THRESHOLD) return false
    return isIOS.value || deferredPrompt.value !== null
  })

  const isIOSPrompt = computed(() => isIOS.value && !isStandalone.value)

  /** Call after each set is logged to track engagement */
  function trackSetLogged() {
    if (state.value.dismissed || state.value.installed || isStandalone.value) return
    state.value = { ...state.value, setsLogged: state.value.setsLogged + 1 }
    saveState(state.value)
  }

  /** Trigger the native install prompt (Chrome/Edge only) */
  async function installApp() {
    const prompt = deferredPrompt.value
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      state.value = { ...state.value, installed: true }
    }
    deferredPrompt.value = null
    saveState(state.value)
  }

  /** Dismiss the banner — don't show again */
  function dismissBanner() {
    state.value = { ...state.value, dismissed: true }
    saveState(state.value)
  }

  return {
    showBanner,
    isIOSPrompt,
    trackSetLogged,
    installApp,
    dismissBanner,
  }
}
