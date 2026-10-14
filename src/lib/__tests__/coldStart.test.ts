/**
 * Cold-start measurement (#1582): the event App.vue fires when the splash
 * comes down, and the rule that every site lifting `loading` in useAuth names
 * the path it took, so the event can never report a lift it cannot attribute.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildColdStartEvent,
  isStandaloneDisplay,
  recordSplashDown,
  COLD_START_EVENT,
  SPLASH_DOWN_MARK,
  type StartupPath,
} from '../coldStart'

describe('buildColdStartEvent', () => {
  it('rounds the duration to whole milliseconds and carries the path and modes', () => {
    expect(buildColdStartEvent({ path: 'stored-session', elapsedMs: 412.6, standalone: true, native: false }))
      .toEqual({ path: 'stored-session', ms: 413, standalone: true, native: false })
  })

  it('names an unattributed lift rather than dropping the event', () => {
    expect(buildColdStartEvent({ path: null, elapsedMs: 100, standalone: false, native: false }).path).toBe('unknown')
  })

  it('never reports a negative duration', () => {
    expect(buildColdStartEvent({ path: 'guest', elapsedMs: -3, standalone: false, native: false }).ms).toBe(0)
  })

  it('keeps the event name the dashboard groups on', () => {
    expect(COLD_START_EVENT).toBe('cold_start')
  })
})

describe('isStandaloneDisplay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (navigator as Navigator & { standalone?: boolean }).standalone
  })

  it('is true under the standalone display-mode media query', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    expect(isStandaloneDisplay()).toBe(true)
  })

  it("falls back to iOS Safari's navigator.standalone", () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    expect(isStandaloneDisplay()).toBe(false)
    ;(navigator as Navigator & { standalone?: boolean }).standalone = true
    expect(isStandaloneDisplay()).toBe(true)
  })

  it('is false in a browser tab, and when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(isStandaloneDisplay()).toBe(false)
  })
})

describe('recordSplashDown', () => {
  it('marks the moment for a profile and returns the time since navigation start', () => {
    const mark = vi.spyOn(performance, 'mark')
    const elapsed = recordSplashDown()
    expect(typeof elapsed).toBe('number')
    expect(elapsed).toBeGreaterThanOrEqual(0)
    expect(mark).toHaveBeenCalledWith(SPLASH_DOWN_MARK)
    mark.mockRestore()
  })

  it('still returns the duration when the mark throws', () => {
    const mark = vi.spyOn(performance, 'mark').mockImplementation(() => { throw new Error('no user timing') })
    expect(typeof recordSplashDown()).toBe('number')
    mark.mockRestore()
  })
})

// A lift that bypassed `liftSplash` would come down with `startupPath` still
// null and report as 'unknown'. The helper is the single owner of the write,
// and every path the union names is one some site actually takes.
describe('every splash lift in useAuth names its path', () => {
  const source = readFileSync(resolve(__dirname, '../../composables/useAuth.ts'), 'utf8')

  it('assigns loading = false in liftSplash and nowhere else', () => {
    const assignments = source.match(/loading\.value = false/g) ?? []
    expect(assignments).toHaveLength(1)
    const helper = source.slice(source.indexOf('function liftSplash('), source.indexOf('\n}\n', source.indexOf('function liftSplash(')))
    expect(helper).toContain('loading.value = false')
  })

  it('takes every path the union names', () => {
    const paths: StartupPath[] = ['stored-session', 'session', 'guest', 'signed-out', 'local', 'error']
    for (const path of paths) {
      expect(source, `no liftSplash site names '${path}'`).toMatch(new RegExp(`'${path}'`))
    }
  })

  it('is what App.vue reports from', () => {
    const app = readFileSync(resolve(__dirname, '../../App.vue'), 'utf8')
    expect(app).toContain('logEvent(COLD_START_EVENT')
    expect(app).toContain('path: startupPath.value')
    // Reported when loading comes down, not at mount: the number is the splash.
    const watchStart = app.indexOf('watch(loading, (isLoading) => {')
    expect(watchStart).toBeGreaterThan(-1)
    expect(app.slice(watchStart, watchStart + 200)).toContain('reportColdStart()')
  })
})
