/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression tests for the hosted privacy page (LIFT-849) — the App Store listing
 * requires a reachable privacy URL, and the AI Coach ships a new third-party
 * sub-processor (Anthropic) whose disclosure must be accurate.
 *
 * Two failure classes are guarded here:
 *  1. SEV1 fabrication — never claim a retention posture ("zero data retention",
 *     "not trained on", etc.) we have not verified in writing.
 *  2. Domain hallucination — the only deployment domain is spa-rho-sandy.vercel.app
 *     (same rule as metaRegression.test.ts).
 */

const DEPLOYMENT_DOMAIN = 'spa-rho-sandy.vercel.app'
const privacyHtml = readFileSync(resolve(__dirname, '../../../public/privacy.html'), 'utf-8')
const legalSheet = readFileSync(resolve(__dirname, '../../components/LegalSheet.vue'), 'utf-8')

describe('hosted /privacy page (public/privacy.html)', () => {
  it('exists and is a complete HTML document', () => {
    expect(privacyHtml).toMatch(/<!DOCTYPE html>/i)
    expect(privacyHtml).toContain('Privacy Policy')
  })

  it('canonical link uses only the real deployment domain', () => {
    const match = privacyHtml.match(/<link rel="canonical" href="([^"]+)"/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain(DEPLOYMENT_DOMAIN)
  })

  it('discloses Anthropic as the AI Coach processor', () => {
    expect(privacyHtml).toContain('Anthropic')
    expect(privacyHtml.toLowerCase()).toContain('ai coach')
  })

  it('states bodyweight is shared unless opted out', () => {
    expect(privacyHtml.toLowerCase()).toContain('bodyweight')
    expect(privacyHtml.toLowerCase()).toContain('opt out')
  })

  it('provides a contact email', () => {
    expect(privacyHtml).toContain('aaronschung@gmail.com')
  })

  it('does NOT fabricate an unverified retention/training posture (SEV1 trap)', () => {
    const lower = privacyHtml.toLowerCase()
    expect(lower).not.toContain('zero data retention')
    expect(lower).not.toContain('not trained on')
    expect(lower).not.toContain('does not train')
    expect(lower).not.toContain('will not be used to train')
  })

  it('references no domain other than the real deployment domain', () => {
    const domains = privacyHtml.match(/[a-z0-9-]+\.(app|com|net|io|co|dev|ai)\b/gi) || []
    const offenders = domains.filter(
      d => !d.endsWith('vercel.app') && !d.includes('gmail.com'),
    )
    expect(offenders).toEqual([])
  })
})

describe('LegalSheet AI Coach disclosure', () => {
  it('names Anthropic and lists the AI Coach fields sent', () => {
    expect(legalSheet).toContain('Anthropic')
    expect(legalSheet).toContain('AI Coach')
  })

  it('does NOT fabricate an unverified retention/training posture (SEV1 trap)', () => {
    const lower = legalSheet.toLowerCase()
    expect(lower).not.toContain('zero data retention')
    expect(lower).not.toContain('not trained on')
  })
})
