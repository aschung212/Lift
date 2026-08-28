import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @vercel/analytics before importing the composable
vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}))

import { track } from '@vercel/analytics'

const mockTrack = vi.mocked(track)

import { useAnalytics } from '../useAnalytics'

describe('useAnalytics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockTrack.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns logEvent, tabSwitch, flushEngagement, and supportFunnel', () => {
    const analytics = useAnalytics()
    expect(typeof analytics.logEvent).toBe('function')
    expect(typeof analytics.tabSwitch).toBe('function')
    expect(typeof analytics.flushEngagement).toBe('function')
    expect(typeof analytics.supportFunnel).toBe('function')
  })

  it('logEvent calls track with name and props', () => {
    const { logEvent } = useAnalytics()
    logEvent('workout_started', { exercise: 'squat' })
    expect(mockTrack).toHaveBeenCalledWith('workout_started', { exercise: 'squat' })
  })

  it('logEvent calls track with empty props by default', () => {
    const { logEvent } = useAnalytics()
    logEvent('app_opened')
    expect(mockTrack).toHaveBeenCalledWith('app_opened', {})
  })

  it('logEvent does not throw when track fails', () => {
    mockTrack.mockImplementation(() => { throw new Error('offline') })
    const { logEvent } = useAnalytics()
    expect(() => logEvent('test_event')).not.toThrow()
  })

  it('tabSwitch logs tab_switch event', () => {
    const { tabSwitch } = useAnalytics()
    vi.advanceTimersByTime(3000)
    tabSwitch('workouts', 'calendar')
    expect(mockTrack).toHaveBeenCalledWith('tab_switch', { from: 'workouts', to: 'calendar' })
  })

  it('tabSwitch logs engagement for previous tab', () => {
    const { tabSwitch } = useAnalytics()
    // Advance time to create engagement duration
    vi.advanceTimersByTime(5000)
    tabSwitch('workouts', 'calendar')
    // Should have logged tab_engagement for the previous tab
    expect(mockTrack).toHaveBeenCalledWith('tab_engagement', expect.objectContaining({
      tab: expect.any(String),
      seconds: expect.any(Number),
    }))
  })

  it('flushEngagement logs current tab engagement', () => {
    const { tabSwitch, flushEngagement } = useAnalytics()
    tabSwitch('workouts', 'calendar')
    mockTrack.mockClear()

    vi.advanceTimersByTime(10000)
    flushEngagement()
    expect(mockTrack).toHaveBeenCalledWith('tab_engagement', {
      tab: 'calendar',
      seconds: 10,
    })
  })

  it('flushEngagement skips logging if 0 seconds elapsed', () => {
    const { tabSwitch, flushEngagement } = useAnalytics()
    tabSwitch('workouts', 'calendar')
    mockTrack.mockClear()

    // Don't advance time
    flushEngagement()
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('tabSwitch does not log engagement with 0 seconds', () => {
    const { tabSwitch } = useAnalytics()
    // Switch tabs without time advancing
    mockTrack.mockClear()
    tabSwitch('workouts', 'calendar')
    // Only tab_switch should be logged, not tab_engagement (0 seconds)
    const engagementCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'tab_engagement'
    )
    expect(engagementCalls).toHaveLength(0)
  })

  it('supportFunnel logs support_funnel with the stage', () => {
    const { supportFunnel } = useAnalytics()
    supportFunnel('impression')
    expect(mockTrack).toHaveBeenCalledWith('support_funnel', { stage: 'impression' })
  })

  it('supportFunnel merges extra props alongside the stage', () => {
    const { supportFunnel } = useAnalytics()
    supportFunnel('tap', { cta: 'github_sponsors' })
    expect(mockTrack).toHaveBeenCalledWith('support_funnel', { stage: 'tap', cta: 'github_sponsors' })
  })

  it('supportFunnel does not throw when track fails', () => {
    mockTrack.mockImplementation(() => { throw new Error('offline') })
    const { supportFunnel } = useAnalytics()
    expect(() => supportFunnel('tap', { cta: 'buymeacoffee' })).not.toThrow()
  })

  it('supports multiple consecutive tab switches', () => {
    const { tabSwitch } = useAnalytics()
    mockTrack.mockClear()

    vi.advanceTimersByTime(2000)
    tabSwitch('workouts', 'calendar')
    vi.advanceTimersByTime(3000)
    tabSwitch('calendar', 'settings')

    const switchCalls = mockTrack.mock.calls.filter(
      ([name]) => name === 'tab_switch'
    )
    expect(switchCalls).toHaveLength(2)
    expect(switchCalls[0][1]).toEqual({ from: 'workouts', to: 'calendar' })
    expect(switchCalls[1][1]).toEqual({ from: 'calendar', to: 'settings' })
  })
})
