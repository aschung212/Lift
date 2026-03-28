import { track } from '@vercel/analytics'

// Session-level tab engagement timing (module singleton)
let _currentTab = 'workouts'
let _tabStart = Date.now()

export function useAnalytics() {
  function logEvent(name, props = {}) {
    try { track(name, props) } catch { /* offline or blocked */ }
  }

  function tabSwitch(fromTab, toTab) {
    if (_currentTab && _tabStart) {
      const seconds = Math.round((Date.now() - _tabStart) / 1000)
      if (seconds > 0) logEvent('tab_engagement', { tab: _currentTab, seconds })
    }
    _currentTab = toTab
    _tabStart = Date.now()
    logEvent('tab_switch', { from: fromTab, to: toTab })
  }

  function flushEngagement() {
    if (_currentTab && _tabStart) {
      const seconds = Math.round((Date.now() - _tabStart) / 1000)
      if (seconds > 0) logEvent('tab_engagement', { tab: _currentTab, seconds })
    }
  }

  return { logEvent, tabSwitch, flushEngagement }
}
