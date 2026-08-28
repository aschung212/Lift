import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @vercel/analytics so we can assert on the emitted event without a network.
vi.mock('@vercel/analytics', () => ({
  track: vi.fn(),
}))

import { track } from '@vercel/analytics'
const mockTrack = vi.mocked(track)

import { captureAcquisitionSource } from '../useAcquisitionSource'

const STORAGE_KEY = 'acquisition-source-v1'

function setLocation(search: string): void {
  window.history.replaceState({}, '', '/' + search)
}

describe('captureAcquisitionSource', () => {
  beforeEach(() => {
    localStorage.clear()
    mockTrack.mockClear()
    setLocation('')
  })

  afterEach(() => {
    setLocation('')
  })

  it('logs acquisition_source with utm params on first load', () => {
    captureAcquisitionSource('?utm_source=producthunt&utm_medium=referral')
    expect(mockTrack).toHaveBeenCalledWith('acquisition_source', {
      utm_source: 'producthunt',
      utm_medium: 'referral',
    })
  })

  it('captures the short ?ref= alias', () => {
    captureAcquisitionSource('?ref=reddit')
    expect(mockTrack).toHaveBeenCalledWith('acquisition_source', { ref: 'reddit' })
  })

  it('persists the captured source under the versioned key', () => {
    captureAcquisitionSource('?ref=tiktok')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ref: 'tiktok' })
  })

  it('does not re-log on subsequent loads once captured', () => {
    captureAcquisitionSource('?ref=tiktok')
    mockTrack.mockClear()
    captureAcquisitionSource('?ref=reddit')
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('records a paramless first visit as direct without logging an event', () => {
    captureAcquisitionSource('')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ref: 'direct' })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('a recorded direct visit blocks a later inbound link from logging', () => {
    captureAcquisitionSource('')
    mockTrack.mockClear()
    captureAcquisitionSource('?utm_source=producthunt')
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('ignores unrelated query params like ?tab=', () => {
    captureAcquisitionSource('?tab=calendar')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ref: 'direct' })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('captures the full utm set', () => {
    captureAcquisitionSource('?utm_source=ph&utm_medium=post&utm_campaign=launch&utm_term=t&utm_content=c')
    expect(mockTrack).toHaveBeenCalledWith('acquisition_source', {
      utm_source: 'ph',
      utm_medium: 'post',
      utm_campaign: 'launch',
      utm_term: 't',
      utm_content: 'c',
    })
  })

  it('trims and caps oversized values to 64 chars', () => {
    const long = 'x'.repeat(200)
    captureAcquisitionSource(`?ref=${long}`)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.ref).toHaveLength(64)
  })

  it('strips acquisition params from the URL but keeps other params', () => {
    setLocation('?utm_source=producthunt&tab=calendar')
    captureAcquisitionSource(window.location.search)
    expect(window.location.search).toBe('?tab=calendar')
  })

  it('clears the query string entirely when only acquisition params are present', () => {
    setLocation('?ref=reddit')
    captureAcquisitionSource(window.location.search)
    expect(window.location.search).toBe('')
  })

  it('treats an empty param value as no source', () => {
    captureAcquisitionSource('?ref=')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ ref: 'direct' })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('does not throw when analytics tracking fails', () => {
    mockTrack.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => captureAcquisitionSource('?ref=reddit')).not.toThrow()
  })
})
