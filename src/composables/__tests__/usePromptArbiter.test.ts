import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePromptArbiter, type ArbiterCandidate } from '../usePromptArbiter'
import {
  readArbiterState,
  MIN_MS_BETWEEN_PROMPTS,
} from '../../lib/promptArbiter'

const NOW = Date.UTC(2026, 7, 25)

beforeEach(() => {
  localStorage.clear()
})

describe('usePromptArbiter.arbitrate', () => {
  it('fires only the winning candidate and records the shown time', () => {
    const review = vi.fn()
    const share = vi.fn()
    const candidates: ArbiterCandidate[] = [
      { kind: 'share', eligible: true, fire: share },
      { kind: 'review', eligible: true, fire: review },
    ]
    const { arbitrate } = usePromptArbiter()

    expect(arbitrate(candidates, NOW)).toBe('review')
    expect(review).toHaveBeenCalledTimes(1)
    expect(share).not.toHaveBeenCalled()
    expect(readArbiterState()).toEqual({ lastShownAt: NOW })
  })

  it('fires nothing and records nothing when no candidate is eligible', () => {
    const fire = vi.fn()
    const { arbitrate } = usePromptArbiter()

    expect(arbitrate([{ kind: 'review', eligible: false, fire }], NOW)).toBeNull()
    expect(fire).not.toHaveBeenCalled()
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
  })

  it('suppresses a second peak moment inside the cooldown', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { arbitrate } = usePromptArbiter()

    expect(arbitrate([{ kind: 'review', eligible: true, fire: first }], NOW)).toBe('review')
    // A theme unlock moments later must not stack a second prompt.
    expect(
      arbitrate([{ kind: 'share', eligible: true, fire: second }], NOW + 1000),
    ).toBeNull()
    expect(second).not.toHaveBeenCalled()
  })

  it('allows another prompt once the cooldown elapses', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { arbitrate } = usePromptArbiter()

    arbitrate([{ kind: 'review', eligible: true, fire: first }], NOW)
    expect(
      arbitrate(
        [{ kind: 'share', eligible: true, fire: second }],
        NOW + MIN_MS_BETWEEN_PROMPTS,
      ),
    ).toBe('share')
    expect(second).toHaveBeenCalledTimes(1)
  })
})
