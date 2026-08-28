import { describe, it, expect, beforeEach } from 'vitest'
import {
  decidePrompt,
  readArbiterState,
  writeArbiterState,
  PROMPT_ARBITER_KEY,
  MIN_MS_BETWEEN_PROMPTS,
  type PromptCandidate,
} from '../promptArbiter'

const NOW = Date.UTC(2026, 7, 25)

beforeEach(() => {
  localStorage.clear()
})

describe('decidePrompt — priority', () => {
  it('returns null when no candidate is eligible', () => {
    const candidates: PromptCandidate[] = [
      { kind: 'review', eligible: false },
      { kind: 'share', eligible: false },
    ]
    expect(decidePrompt(candidates, { lastShownAt: 0 }, NOW)).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(decidePrompt([], { lastShownAt: 0 }, NOW)).toBeNull()
  })

  it('picks the only eligible candidate', () => {
    const candidates: PromptCandidate[] = [
      { kind: 'review', eligible: false },
      { kind: 'share', eligible: true },
    ]
    expect(decidePrompt(candidates, { lastShownAt: 0 }, NOW)).toBe('share')
  })

  it('prefers review over share over supporter when several are eligible', () => {
    const all: PromptCandidate[] = [
      { kind: 'supporter', eligible: true },
      { kind: 'share', eligible: true },
      { kind: 'review', eligible: true },
    ]
    expect(decidePrompt(all, { lastShownAt: 0 }, NOW)).toBe('review')
    // Ordering is by priority, not array position.
    expect(decidePrompt([...all].reverse(), { lastShownAt: 0 }, NOW)).toBe('review')
  })

  it('falls through to share when review is ineligible', () => {
    const candidates: PromptCandidate[] = [
      { kind: 'review', eligible: false },
      { kind: 'share', eligible: true },
      { kind: 'supporter', eligible: true },
    ]
    expect(decidePrompt(candidates, { lastShownAt: 0 }, NOW)).toBe('share')
  })
})

describe('decidePrompt — global cooldown', () => {
  const eligible: PromptCandidate[] = [{ kind: 'review', eligible: true }]

  it('suppresses a second prompt inside the cooldown window', () => {
    const state = { lastShownAt: NOW }
    expect(decidePrompt(eligible, state, NOW + MIN_MS_BETWEEN_PROMPTS - 1)).toBeNull()
  })

  it('allows a prompt once the cooldown has elapsed', () => {
    const state = { lastShownAt: NOW }
    expect(decidePrompt(eligible, state, NOW + MIN_MS_BETWEEN_PROMPTS)).toBe('review')
  })

  it('treats a zero timestamp as never-shown', () => {
    expect(decidePrompt(eligible, { lastShownAt: 0 }, NOW)).toBe('review')
  })
})

describe('arbiter state persistence', () => {
  it('round-trips through localStorage', () => {
    writeArbiterState({ lastShownAt: NOW })
    expect(readArbiterState()).toEqual({ lastShownAt: NOW })
  })

  it('falls back to fresh state when nothing is stored', () => {
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
  })

  it('ignores corrupt JSON', () => {
    localStorage.setItem(PROMPT_ARBITER_KEY, '{not json')
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
  })

  it('sanitizes a non-numeric or negative timestamp to 0', () => {
    localStorage.setItem(PROMPT_ARBITER_KEY, JSON.stringify({ lastShownAt: 'soon' }))
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
    localStorage.setItem(PROMPT_ARBITER_KEY, JSON.stringify({ lastShownAt: -5 }))
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
  })

  it('rejects a non-object payload (array)', () => {
    localStorage.setItem(PROMPT_ARBITER_KEY, JSON.stringify([NOW]))
    expect(readArbiterState()).toEqual({ lastShownAt: 0 })
  })
})
