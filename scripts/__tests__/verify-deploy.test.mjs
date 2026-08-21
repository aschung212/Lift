// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractProdDomain,
  isHealthyResponse,
  verifyDeploy,
  HEALTH_MARKERS,
} from '../verify-deploy.mjs'

/**
 * Behavioral coverage for the production deploy smoke-test (LIFT-1167).
 *
 * The point of this script is to stop CI from posting "✅ Deployed to
 * production" when Vercel's out-of-band git deploy actually failed. These
 * tests pin the two decision surfaces that make that guarantee real:
 *
 * 1. The prod domain is extracted from CLAUDE.md, never hardcoded (SEV1 rule).
 * 2. Only a genuine 200 app-shell response counts as healthy — a redirect,
 *    an error page, or a stray 200 without our markers must fail so the run
 *    routes to `notify-failure`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLAUDE_MD = resolve(__dirname, '..', '..', 'CLAUDE.md')

const APP_SHELL = `<!DOCTYPE html><html><head><title>Lift — Workout Tracker</title></head><body><div id="app"></div></body></html>`

describe('extractProdDomain', () => {
  it('reads the canonical domain from the real CLAUDE.md **Live:** line', () => {
    const md = readFileSync(CLAUDE_MD, 'utf8')
    expect(extractProdDomain(md)).toBe('spa-rho-sandy.vercel.app')
  })

  it('throws rather than fabricating a domain when the marker is missing', () => {
    expect(() => extractProdDomain('# No live line here')).toThrow(/production domain/i)
  })
})

describe('isHealthyResponse', () => {
  it('accepts a 200 that carries every app-shell marker', () => {
    expect(isHealthyResponse(200, APP_SHELL)).toBe(true)
  })

  it('rejects a non-200 even when the body looks like the app', () => {
    expect(isHealthyResponse(302, APP_SHELL)).toBe(false)
    expect(isHealthyResponse(500, APP_SHELL)).toBe(false)
  })

  it('rejects a 200 that is missing an app-shell marker (error/parked page)', () => {
    expect(isHealthyResponse(200, '<html><body>Deployment failed</body></html>')).toBe(false)
    // Has the app root but not the title → still rejected (must match all)
    expect(isHealthyResponse(200, '<div id="app"></div>')).toBe(false)
  })

  it('rejects a non-string body', () => {
    expect(isHealthyResponse(200, null)).toBe(false)
  })

  it('every documented marker actually appears in the app shell fixture', () => {
    for (const marker of HEALTH_MARKERS) {
      expect(APP_SHELL).toContain(marker)
    }
  })
})

describe('verifyDeploy', () => {
  const opts = () => ({ url: 'https://example.test/', sleep: vi.fn().mockResolvedValue(), log: vi.fn() })

  it('resolves true as soon as a healthy response arrives', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, body: APP_SHELL })
    await expect(verifyDeploy({ ...opts(), fetchImpl })).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries past transient failures until the deploy becomes healthy', async () => {
    const o = opts()
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 503, body: 'building' })
      .mockResolvedValueOnce({ status: 200, body: APP_SHELL })
    await expect(verifyDeploy({ ...o, fetchImpl })).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // slept between the two failed attempts, not after the success
    expect(o.sleep).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting attempts when the deploy never goes healthy', async () => {
    const o = opts()
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404, body: 'not found' })
    await expect(verifyDeploy({ ...o, fetchImpl, attempts: 3 })).rejects.toThrow(
      /failed after 3 attempts/i,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // no sleep after the final attempt
    expect(o.sleep).toHaveBeenCalledTimes(2)
  })
})
