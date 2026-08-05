import { track } from '@vercel/analytics'

type AllowedPropertyValues = string | number | boolean | null | undefined

// Session-level tab engagement timing (module singleton)
let _currentTab = 'workouts'
let _tabStart = Date.now()

/**
 * Supporter conversion funnel (LIFT-906). One event name (`support_funnel`)
 * with a `stage` discriminator so impression → tap → purchase → restore can be
 * grouped as a single funnel in the analytics dashboard, mirroring the existing
 * share funnel. `impression` means the Support CTAs actually scrolled into view
 * (not merely that Settings opened), so tap/impression is a meaningful
 * conversion rate. `purchase`/`restore` are reserved for the native IAP wiring
 * (LIFT-598 / LIFT-910); only `impression` and `tap` fire today.
 */
export type SupportFunnelStage = 'impression' | 'tap' | 'purchase' | 'restore'

export interface UseAnalyticsReturn {
  logEvent: (name: string, props?: Record<string, AllowedPropertyValues>) => void
  tabSwitch: (fromTab: string, toTab: string) => void
  flushEngagement: () => void
  supportFunnel: (stage: SupportFunnelStage, props?: Record<string, AllowedPropertyValues>) => void
}

export function useAnalytics(): UseAnalyticsReturn {
  function logEvent(name: string, props: Record<string, AllowedPropertyValues> = {}): void {
    try { track(name, props) } catch { /* offline or blocked */ }
  }

  function tabSwitch(fromTab: string, toTab: string): void {
    if (_currentTab && _tabStart) {
      const seconds = Math.round((Date.now() - _tabStart) / 1000)
      if (seconds > 0) logEvent('tab_engagement', { tab: _currentTab, seconds })
    }
    _currentTab = toTab
    _tabStart = Date.now()
    logEvent('tab_switch', { from: fromTab, to: toTab })
  }

  function flushEngagement(): void {
    if (_currentTab && _tabStart) {
      const seconds = Math.round((Date.now() - _tabStart) / 1000)
      if (seconds > 0) logEvent('tab_engagement', { tab: _currentTab, seconds })
    }
  }

  function supportFunnel(stage: SupportFunnelStage, props: Record<string, AllowedPropertyValues> = {}): void {
    logEvent('support_funnel', { stage, ...props })
  }

  return { logEvent, tabSwitch, flushEngagement, supportFunnel }
}
