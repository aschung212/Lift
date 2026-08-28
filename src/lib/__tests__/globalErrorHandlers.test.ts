/**
 * Tests for the global error/rejection capture floor (LIFT-1227).
 *
 * This is the ONLY capture path for fire-and-forget promise rejections and
 * uncaught runtime errors in dev / DSN-less builds, so the dedupe and rate-cap
 * behavior is load-bearing: without it a tight rejection loop could flood the
 * sink (and Sentry, when configured) from one page load.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createGlobalErrorHandler,
  toError,
  errorSignature,
  type GlobalErrorSource,
} from '../globalErrorHandlers'

function rejection(reason: unknown): PromiseRejectionEvent {
  return { reason } as PromiseRejectionEvent
}

function errorEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    error: new Error('boom'),
    message: 'boom',
    ...overrides,
  } as ErrorEvent
}

describe('toError', () => {
  it('passes an Error through unchanged', () => {
    const err = new Error('x')
    expect(toError(err)).toBe(err)
  })

  it('wraps a string reason', () => {
    expect(toError('nope').message).toBe('nope')
  })

  it('extracts message from a {message} object rather than [object Object]', () => {
    expect(toError({ message: 'from object' }).message).toBe('from object')
  })

  it('stringifies anything else', () => {
    expect(toError(42).message).toBe('42')
    expect(toError(null).message).toBe('null')
  })
})

describe('errorSignature', () => {
  it('keys on name + message', () => {
    const err = new TypeError('bad access')
    expect(errorSignature(err)).toBe('TypeError: bad access')
  })
})

describe('createGlobalErrorHandler', () => {
  it('forwards a promise rejection with the unhandledrejection source', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.handleRejection(rejection(new Error('async fail')))
    expect(sink).toHaveBeenCalledTimes(1)
    const [error, source] = sink.mock.calls[0] as [Error, GlobalErrorSource]
    expect(error.message).toBe('async fail')
    expect(source).toBe('unhandledrejection')
  })

  it('forwards an uncaught error with the window.onerror source', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.handleError(errorEvent({ error: new Error('sync fail') }))
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][1]).toBe('window.onerror')
  })

  it('falls back to the message when a cross-origin error has no .error', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.handleError(errorEvent({ error: undefined, message: 'Script error.' }))
    expect(sink.mock.calls[0][0].message).toBe('Script error.')
  })

  it('dedupes repeated rejections of the same signature', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.handleRejection(rejection(new Error('same')))
    handler.handleRejection(rejection(new Error('same')))
    handler.handleRejection(rejection(new Error('same')))
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('reports the same message from a rejection and an error separately (distinct source)', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.handleRejection(rejection(new Error('shared')))
    handler.handleError(errorEvent({ error: new Error('shared') }))
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('caps total forwards per page load', () => {
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink, { maxReports: 2 })
    handler.handleRejection(rejection(new Error('1')))
    handler.handleRejection(rejection(new Error('2')))
    handler.handleRejection(rejection(new Error('3')))
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('start/stop bind and unbind both window listeners', () => {
    const target = new EventTarget()
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)

    handler.start(target)
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('a') }))
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('b') }))
    expect(sink).toHaveBeenCalledTimes(2)

    handler.stop(target)
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('c') }))
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('d') }))
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('start is idempotent (no duplicate listeners)', () => {
    const target = new EventTarget()
    const sink = vi.fn()
    const handler = createGlobalErrorHandler(sink)
    handler.start(target)
    handler.start(target)
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('once') }))
    expect(sink).toHaveBeenCalledTimes(1)
  })
})

describe('main.ts wiring (LIFT-1227)', () => {
  const mainSrc = readFileSync(resolve(__dirname, '../../main.ts'), 'utf-8')

  it('imports the global error handler', () => {
    expect(mainSrc).toMatch(/from\s*['"]\.\/lib\/globalErrorHandlers['"]/)
  })

  it('registers it unconditionally at top level — not gated behind Sentry or platform', () => {
    // The whole point is a capture floor for dev / DSN-less builds. A call
    // nested inside `if (sentryDsn ...)` or `if (!isNative)` would be indented;
    // requiring the call to start at column 0 proves it runs on every build.
    expect(mainSrc).toMatch(/\ncreateGlobalErrorHandler\(/)
  })

  it('routes global errors through logError so they reach Sentry when configured', () => {
    expect(mainSrc).toMatch(/createGlobalErrorHandler\(\s*\(error, source\)\s*=>\s*\{[\s\S]*logError\(error/)
  })
})
