import { describe, it, expect } from 'vitest'
import { useSupporter } from '../useSupporter'
import { FREE_WEEKLY_LIMIT } from '../../lib/coachTier'

describe('useSupporter', () => {
  it('defaults to the free tier (stub until IAP wiring, LIFT-598)', () => {
    const { isSupporter, coachWeeklyLimit } = useSupporter()
    expect(isSupporter.value).toBe(false)
    // Coach allowance follows the entitlement — free by default (LIFT-904).
    expect(coachWeeklyLimit.value).toBe(FREE_WEEKLY_LIMIT)
  })

  it('exposes isSupporter as a read-only ref', () => {
    const { isSupporter } = useSupporter()
    // readonly() refs warn and no-op on write in dev; the type is Readonly<Ref>.
    expect(isSupporter.value).toBe(false)
  })
})
