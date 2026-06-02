import { describe, it, expect } from 'vitest'
import { useSupporter } from '../useSupporter'

describe('useSupporter', () => {
  it('defaults to locked (not a supporter) so paid perks are never free by accident', () => {
    // Safety property for gated perks (#601 watermark, #603 data export):
    // until the IAP entitlement (#598) flips this on, EVERYONE is free tier.
    // A regression to default-true would hand out supporter perks for free.
    const { isSupporter } = useSupporter()
    expect(isSupporter.value).toBe(false)
  })

  it('exposes the same module-level singleton across calls', () => {
    const a = useSupporter()
    const b = useSupporter()
    expect(a.isSupporter).toBe(b.isSupporter)
  })

  it('returns a read-only ref that cannot be mutated by consumers', () => {
    const { isSupporter } = useSupporter()
    // readonly() refs warn and refuse writes in dev; the value must not change.
    ;(isSupporter as unknown as { value: boolean }).value = true
    expect(isSupporter.value).toBe(false)
  })
})
