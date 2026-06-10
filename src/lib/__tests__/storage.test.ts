import { describe, it, expect, beforeEach } from 'vitest'
import { loadJSON, isPlainObject } from '../storage'

beforeEach(() => {
  localStorage.clear()
})

describe('loadJSON', () => {
  it('returns the parsed value for valid JSON', () => {
    localStorage.setItem('k', JSON.stringify([1, 2, 3]))
    expect(loadJSON<number[]>('k', [])).toEqual([1, 2, 3])
  })

  it('returns the fallback when the key is absent', () => {
    expect(loadJSON('missing', 'default')).toBe('default')
  })

  it('returns the fallback for unparseable JSON instead of throwing', () => {
    localStorage.setItem('k', '{not json')
    expect(loadJSON<string[]>('k', [])).toEqual([])
  })

  it('returns the fallback when validate rejects the parsed shape', () => {
    localStorage.setItem('k', JSON.stringify('not-an-array'))
    expect(loadJSON<string[]>('k', [], Array.isArray)).toEqual([])
  })

  it('accepts values that pass validate', () => {
    localStorage.setItem('k', JSON.stringify({ a: 1 }))
    expect(loadJSON('k', {}, isPlainObject)).toEqual({ a: 1 })
  })
})

describe('isPlainObject', () => {
  it('accepts objects, rejects arrays and null', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('s')).toBe(false)
  })
})
