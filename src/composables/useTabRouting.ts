import { ref, nextTick, type Ref } from 'vue'

/**
 * The three top-level tabs. Kept here (not in the view) so tab resolution and
 * validation have a single owner shared by the router and any deep-link handling.
 */
export const VALID_TABS = ['workouts', 'calendar', 'weight'] as const
export type TabId = (typeof VALID_TABS)[number]

const ACTIVE_TAB_KEY = 'active-tab'

export interface TabRoutingOptions {
  /** The scrollable tab-content element, used to preserve per-tab scroll offset. */
  scrollContainer: Ref<HTMLElement | null>
  /**
   * Runs on every switchTab call — including a tap on the already-active tab —
   * before the early-return. Used to dismiss transient UI (e.g. settings sheet).
   */
  onBeforeSwitch?: () => void
  /** Runs only when the tab actually changes, after activeTab updates. */
  onSwitch?: (from: string, to: string) => void
  /** Query string to resolve the initial tab from (defaults to live location). */
  search?: string
}

export interface TabRouting {
  /** The currently active tab id. */
  activeTab: Ref<string>
  /** Switch to a tab, persisting the choice and preserving scroll positions. */
  switchTab: (tabId: string) => void
}

/**
 * Resolve the initial tab: a valid `?tab=` deep-link param wins (PWA manifest
 * shortcuts use it), then the last persisted tab, then the Workouts default.
 */
function resolveInitialTab(search: string): string {
  const urlTab = new URLSearchParams(search).get('tab')
  if (urlTab && (VALID_TABS as readonly string[]).includes(urlTab)) return urlTab
  return localStorage.getItem(ACTIVE_TAB_KEY) || 'workouts'
}

/**
 * Owns top-level tab routing: initial-tab resolution (`?tab=` deep-link →
 * persisted → default), `?tab=` cleanup so it doesn't persist on reload or leak
 * into shared links, active-tab persistence, and per-tab scroll preservation.
 *
 * Side effects that belong to the shell (analytics, service-worker update check,
 * closing the settings sheet) are injected via `onSwitch`/`onBeforeSwitch` so the
 * router stays free of view-specific concerns and is unit-testable in isolation.
 */
export function useTabRouting(options: TabRoutingOptions): TabRouting {
  const search = options.search ?? window.location.search
  const activeTab = ref<string>(resolveInitialTab(search))

  // Strip the query param so a deep-link `?tab=` doesn't persist on reload.
  const urlTab = new URLSearchParams(search).get('tab')
  if (urlTab && typeof window !== 'undefined' && window.history?.replaceState) {
    const url = new URL(window.location.href)
    url.searchParams.delete('tab')
    window.history.replaceState({}, '', url.pathname)
  }

  const scrollPositions: Record<string, number> = {}

  function switchTab(tabId: string) {
    const from = activeTab.value
    options.onBeforeSwitch?.()
    if (from === tabId) return
    // Save scroll position of the outgoing tab before it unmounts.
    const container = options.scrollContainer.value
    if (container) scrollPositions[from] = container.scrollTop
    activeTab.value = tabId
    localStorage.setItem(ACTIVE_TAB_KEY, tabId)
    options.onSwitch?.(from, tabId)
    // Restore scroll position of the incoming tab (default to top).
    nextTick(() => {
      if (options.scrollContainer.value) {
        options.scrollContainer.value.scrollTop = scrollPositions[tabId] ?? 0
      }
    })
  }

  return { activeTab, switchTab }
}
