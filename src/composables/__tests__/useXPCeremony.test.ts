import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spy on the analytics sink directly so we assert the real logEvent → track path.
vi.mock('@vercel/analytics', () => ({ track: vi.fn() }))
import { track } from '@vercel/analytics'
const mockTrack = vi.mocked(track)

// App review and XP instrumentation are side-effecting no-ops here.
vi.mock('../useAppReview', () => ({
  useAppReview: () => ({ requestReviewAtMoment: vi.fn() }),
  canRequestReview: vi.fn(() => true),
}))
vi.mock('../../lib/xpInstrumentation', () => ({
  logXPEvent: vi.fn(),
  logBodyweightXPEvent: vi.fn(),
}))

// Configurable fake progression store. `checkUnlocks` drives the unlock path.
const fakeStore = {
  _userId: 'user-1',
  epoch: 0,
  progressionEnabled: true,
  starterConfirmed: true,
  starterTheme: 'fire',
  showProgression: false,
  progressPercent: 0,
  totalXP: 0,
  nextUnlockThreshold: 100,
  unlockedThemes: [] as unknown[],
  recordSetXP: vi.fn(),
  creditSetXP: vi.fn(),
  checkUnlocks: vi.fn(() => [] as string[]),
}

vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => fakeStore,
  showXPToast: vi.fn(),
  showUnlockCelebration: vi.fn(),
}))

import { useXPCeremony } from '../useXPCeremony'

function ceremonyInput(overrides: Record<string, unknown> = {}) {
  return {
    setId: 'set-1',
    exerciseId: 'ex-1',
    xp: 10,
    baseXP: 10,
    zone: 'working' as const,
    isPR: false,
    isTie: false,
    isRepPR: false,
    activeTheme: 'eternal',
    estimated1RM: 100,
    exerciseBest1RM: 120,
    streakMultiplier: 1,
    ...overrides,
  }
}

describe('useXPCeremony — theme_unlocked analytics (#796)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockTrack.mockClear()
    fakeStore.checkUnlocks.mockReturnValue([])
    fakeStore.unlockedThemes = []
    fakeStore.totalXP = 0
    fakeStore.epoch = 0
  })

  it('does not log theme_unlocked when no themes unlock', () => {
    fakeStore.checkUnlocks.mockReturnValue([])
    const { logSetXPCeremony } = useXPCeremony()
    logSetXPCeremony(ceremonyInput())
    const calls = mockTrack.mock.calls.filter(([name]) => name === 'theme_unlocked')
    expect(calls).toHaveLength(0)
  })

  it('logs theme_unlocked with progression-depth props on an organic unlock', () => {
    fakeStore.checkUnlocks.mockReturnValue(['water'])
    fakeStore.unlockedThemes = [{ id: 'fire' }, { id: 'water' }]
    fakeStore.totalXP = 250
    fakeStore.epoch = 1
    const { logSetXPCeremony } = useXPCeremony()
    logSetXPCeremony(ceremonyInput())

    expect(mockTrack).toHaveBeenCalledWith('theme_unlocked', {
      theme: 'water',
      totalXP: 250,
      unlockedCount: 2,
      epoch: 1,
    })
  })

  it('logs one theme_unlocked event per newly unlocked theme', () => {
    fakeStore.checkUnlocks.mockReturnValue(['fire', 'water', 'luck'])
    fakeStore.unlockedThemes = [{ id: 'fire' }, { id: 'water' }, { id: 'luck' }]
    const { logSetXPCeremony } = useXPCeremony()
    logSetXPCeremony(ceremonyInput())

    const calls = mockTrack.mock.calls.filter(([name]) => name === 'theme_unlocked')
    expect(calls).toHaveLength(3)
    expect(calls.map(([, props]) => (props as { theme: string }).theme)).toEqual([
      'fire', 'water', 'luck',
    ])
  })

  it('does not log theme_unlocked when progression is disabled (no unlock path)', () => {
    fakeStore.progressionEnabled = false
    fakeStore.checkUnlocks.mockReturnValue(['water'])
    const { logSetXPCeremony } = useXPCeremony()
    logSetXPCeremony(ceremonyInput())
    const calls = mockTrack.mock.calls.filter(([name]) => name === 'theme_unlocked')
    expect(calls).toHaveLength(0)
    fakeStore.progressionEnabled = true
  })
})
