import { describe, it, expect, vi } from 'vitest'
import { useShareFlow, isShareCancellation, type ShareResult } from '../useShareFlow'

describe('isShareCancellation', () => {
  it('treats a DOMException AbortError as a cancellation', () => {
    expect(isShareCancellation(new DOMException('dismissed', 'AbortError'))).toBe(true)
  })

  it('does not treat other DOMExceptions as cancellations', () => {
    expect(isShareCancellation(new DOMException('nope', 'NotAllowedError'))).toBe(false)
  })

  it('treats an error message mentioning cancel/abort as a cancellation', () => {
    expect(isShareCancellation(new Error('Share canceled'))).toBe(true)
    expect(isShareCancellation(new Error('operation was aborted'))).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isShareCancellation(new Error('User CANCELLED the sheet'))).toBe(true)
  })

  it('returns false for an unrelated error', () => {
    expect(isShareCancellation(new Error('network down'))).toBe(false)
  })

  it('returns false for non-error values', () => {
    expect(isShareCancellation(undefined)).toBe(false)
    expect(isShareCancellation(null)).toBe(false)
    expect(isShareCancellation('cancel')).toBe(false) // no .message property
  })
})

describe('useShareFlow', () => {
  it('starts with isSharing false and lastError null', () => {
    const { isSharing, lastError } = useShareFlow()
    expect(isSharing.value).toBe(false)
    expect(lastError.value).toBeNull()
  })

  it('returns the first terminal result and skips later tiers', async () => {
    const { run } = useShareFlow()
    const second = vi.fn<() => Promise<ShareResult | null>>()
    const result = await run([
      async () => ({ kind: 'shared' }),
      second,
    ])
    expect(result).toEqual({ kind: 'shared' })
    expect(second).not.toHaveBeenCalled()
  })

  it('falls through null-returning tiers to the next one', async () => {
    const { run } = useShareFlow()
    const result = await run([
      async () => null,
      async () => null,
      async () => ({ kind: 'copied' }),
    ])
    expect(result).toEqual({ kind: 'copied' })
  })

  it('resolves unavailable when every tier falls through', async () => {
    const { run } = useShareFlow()
    const result = await run([async () => null, async () => null])
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('resolves unavailable for an empty tier list', async () => {
    const { run } = useShareFlow()
    expect(await run([])).toEqual({ kind: 'unavailable' })
  })

  it('captures a thrown error into lastError and resolves as error', async () => {
    const { run, lastError } = useShareFlow()
    const boom = new Error('boom')
    const result = await run([
      async () => {
        throw boom
      },
    ])
    expect(result).toEqual({ kind: 'error', error: boom })
    expect(lastError.value).toBe(boom)
  })

  it('clears lastError at the start of each run', async () => {
    const { run, lastError } = useShareFlow()
    await run([
      async () => {
        throw new Error('first')
      },
    ])
    expect(lastError.value).not.toBeNull()

    await run([async () => ({ kind: 'shared' })])
    expect(lastError.value).toBeNull()
  })

  it('toggles isSharing true during the run and false afterward', async () => {
    const { run, isSharing } = useShareFlow()
    let seenDuring = false
    const promise = run([
      async () => {
        seenDuring = isSharing.value
        return { kind: 'shared' }
      },
    ])
    await promise
    expect(seenDuring).toBe(true)
    expect(isSharing.value).toBe(false)
  })

  it('resets isSharing even when a tier throws', async () => {
    const { run, isSharing } = useShareFlow()
    await run([
      async () => {
        throw new Error('kaboom')
      },
    ])
    expect(isSharing.value).toBe(false)
  })

  it('guards against re-entrant runs while one is in flight', async () => {
    const { run, isSharing } = useShareFlow()
    let resolveFirst!: () => void
    const first = run([
      () =>
        new Promise<ShareResult | null>((resolve) => {
          resolveFirst = () => resolve({ kind: 'shared' })
        }),
    ])
    expect(isSharing.value).toBe(true)

    const second = vi.fn<() => Promise<ShareResult | null>>()
    const secondResult = await run([second])
    expect(secondResult).toEqual({ kind: 'cancelled' })
    expect(second).not.toHaveBeenCalled()

    resolveFirst()
    expect(await first).toEqual({ kind: 'shared' })
    expect(isSharing.value).toBe(false)
  })
})
