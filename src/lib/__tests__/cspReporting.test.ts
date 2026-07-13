/**
 * Tests for client-side CSP violation reporting (LIFT-810).
 *
 * The reporter is the only telemetry path for blocked resources, so the dedupe
 * and rate-cap behavior is load-bearing: without it a single misconfigured
 * policy (or a hostile injection loop) could flood Sentry from one page load.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createCspReporter,
  extractViolation,
  violationKey,
  violationSummary,
  type CspViolationReport,
} from '../cspReporting'

/** Build a fake SecurityPolicyViolationEvent with sensible defaults. */
function fakeEvent(
  overrides: Partial<SecurityPolicyViolationEvent> = {},
): SecurityPolicyViolationEvent {
  return {
    documentURI: 'https://spa-rho-sandy.vercel.app/',
    violatedDirective: 'script-src',
    effectiveDirective: 'script-src',
    blockedURI: 'https://evil.example.com/x.js',
    sourceFile: 'https://spa-rho-sandy.vercel.app/',
    lineNumber: 10,
    columnNumber: 5,
    disposition: 'enforce',
    ...overrides,
  } as SecurityPolicyViolationEvent
}

describe('extractViolation', () => {
  it('pulls the reportable fields off the event', () => {
    const report = extractViolation(fakeEvent())
    expect(report).toEqual<CspViolationReport>({
      documentURI: 'https://spa-rho-sandy.vercel.app/',
      violatedDirective: 'script-src',
      effectiveDirective: 'script-src',
      blockedURI: 'https://evil.example.com/x.js',
      sourceFile: 'https://spa-rho-sandy.vercel.app/',
      lineNumber: 10,
      columnNumber: 5,
      disposition: 'enforce',
    })
  })

  it('falls back from effectiveDirective to legacy violatedDirective', () => {
    const report = extractViolation(
      fakeEvent({ effectiveDirective: '', violatedDirective: 'img-src' }),
    )
    expect(report.effectiveDirective).toBe('img-src')
    expect(report.violatedDirective).toBe('img-src')
  })

  it('defaults missing numeric/string fields rather than emitting undefined', () => {
    const report = extractViolation({
      effectiveDirective: 'style-src',
    } as SecurityPolicyViolationEvent)
    expect(report.lineNumber).toBe(0)
    expect(report.columnNumber).toBe(0)
    expect(report.blockedURI).toBe('')
    expect(report.documentURI).toBe('')
  })
})

describe('violationKey', () => {
  it('keys on directive + blocked resource', () => {
    expect(violationKey(extractViolation(fakeEvent()))).toBe(
      'script-src|https://evil.example.com/x.js',
    )
  })
})

describe('violationSummary', () => {
  it('produces a readable one-liner for grouping in Sentry', () => {
    expect(violationSummary(extractViolation(fakeEvent()))).toBe(
      'CSP violation: script-src blocked https://evil.example.com/x.js',
    )
  })

  it('labels an inline (empty blockedURI) violation as inline', () => {
    const report = extractViolation(fakeEvent({ blockedURI: '' }))
    expect(violationSummary(report)).toBe('CSP violation: script-src blocked inline')
  })
})

describe('createCspReporter', () => {
  it('forwards a violation to the sink', () => {
    const sink = vi.fn()
    const reporter = createCspReporter(sink)
    reporter.handleViolation(fakeEvent())
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0].blockedURI).toBe('https://evil.example.com/x.js')
  })

  it('dedupes repeated violations of the same directive + resource', () => {
    const sink = vi.fn()
    const reporter = createCspReporter(sink)
    reporter.handleViolation(fakeEvent())
    reporter.handleViolation(fakeEvent())
    reporter.handleViolation(fakeEvent())
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('still reports distinct directive/resource pairs', () => {
    const sink = vi.fn()
    const reporter = createCspReporter(sink)
    reporter.handleViolation(fakeEvent({ blockedURI: 'https://a.example/x.js' }))
    reporter.handleViolation(fakeEvent({ blockedURI: 'https://b.example/y.js' }))
    reporter.handleViolation(fakeEvent({ effectiveDirective: 'img-src' }))
    expect(sink).toHaveBeenCalledTimes(3)
  })

  it('caps total forwards per page load', () => {
    const sink = vi.fn()
    const reporter = createCspReporter(sink, { maxReports: 2 })
    reporter.handleViolation(fakeEvent({ blockedURI: 'https://a.example/1.js' }))
    reporter.handleViolation(fakeEvent({ blockedURI: 'https://b.example/2.js' }))
    reporter.handleViolation(fakeEvent({ blockedURI: 'https://c.example/3.js' }))
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('start/stop bind and unbind the document listener', () => {
    const target = new EventTarget()
    const sink = vi.fn()
    const reporter = createCspReporter(sink)

    reporter.start(target)
    target.dispatchEvent(
      Object.assign(new Event('securitypolicyviolation'), fakeEvent()),
    )
    expect(sink).toHaveBeenCalledTimes(1)

    reporter.stop(target)
    target.dispatchEvent(
      Object.assign(new Event('securitypolicyviolation'), fakeEvent({
        blockedURI: 'https://other.example/z.js',
      })),
    )
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('start is idempotent (no duplicate listeners)', () => {
    const target = new EventTarget()
    const sink = vi.fn()
    const reporter = createCspReporter(sink)
    reporter.start(target)
    reporter.start(target)
    target.dispatchEvent(
      Object.assign(new Event('securitypolicyviolation'), fakeEvent()),
    )
    expect(sink).toHaveBeenCalledTimes(1)
  })
})

describe('main.ts wiring (LIFT-810)', () => {
  const mainSrc = readFileSync(resolve(__dirname, '../../main.ts'), 'utf-8')

  it('imports the CSP reporter', () => {
    expect(mainSrc).toMatch(/from\s*['"]\.\/lib\/cspReporting['"]/)
  })

  it('gates CSP reporting behind the native-platform check (web-only)', () => {
    // The native Capacitor build serves no Vercel CSP header, so no violations
    // can fire there — keep the listener web-only like the analytics gating.
    expect(mainSrc).toMatch(/createCspReporter/)
    // The call site is the last `createCspReporter` reference (the first is the
    // import). It must sit after an `if (!isNative)` gate.
    const callSite = mainSrc.lastIndexOf('createCspReporter')
    const nativeGate = mainSrc.lastIndexOf('if (!isNative)', callSite)
    expect(nativeGate).toBeGreaterThan(-1)
  })

  it('routes violations through logError so they reach Sentry', () => {
    expect(mainSrc).toMatch(/logError\([^)]*cspViolation/)
  })
})
