/// <reference types="node" />
/**
 * Shared fixtures for static-artifact guardrail tests (LIFT-1012).
 *
 * Several regression suites (metaRegression, seoRegression, manifestRegression,
 * launchScreens, …) each independently `readFileSync` the same build artifacts
 * (index.html, public/robots.txt, public/sitemap.xml) and re-declare the same
 * deployment-domain / competitor-domain literals. That duplication is the
 * maintenance surface LIFT-1012 flags: an infra change forces edits across a
 * wall of near-identical files. This module is the single reconciliation point —
 * one cached read per artifact, one domain allow/deny list, one set of shared
 * assertions.
 *
 * DEPLOYMENT_DOMAIN is deliberately an INDEPENDENT literal, NOT imported from
 * src/lib/appMeta. The whole point of these guards is to pin the shipped URLs
 * against a known-good value the app code cannot silently redefine — comparing
 * against APP_URL would make the guard tautologically pass when APP_URL is
 * itself corrupted (the exact SEV1 class from 2026-04-02, see CLAUDE.md).
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { expect } from 'vitest'

/** The one and only valid production deployment host. */
export const DEPLOYMENT_DOMAIN = 'spa-rho-sandy.vercel.app'
export const DEPLOYMENT_ORIGIN = `https://${DEPLOYMENT_DOMAIN}`

/** Domains we do NOT own — must never appear in any shipped artifact. */
export const UNOWNED_DOMAINS = ['liftracker.app'] as const

const ROOT = resolve(__dirname, '../../..')
export const PUBLIC_DIR = resolve(ROOT, 'public')

const readCache = new Map<string, string>()

function readCached(absPath: string): string {
  let content = readCache.get(absPath)
  if (content === undefined) {
    content = readFileSync(absPath, 'utf-8')
    readCache.set(absPath, content)
  }
  return content
}

/** Read a repo-root-relative file (e.g. 'index.html', 'vite.config.js'). */
export function readRootFile(relPath: string): string {
  return readCached(resolve(ROOT, relPath))
}

/** Read a public/-relative file (e.g. 'robots.txt', 'sitemap.xml'). */
export function readPublicFile(relPath: string): string {
  return readCached(resolve(PUBLIC_DIR, relPath))
}

/** Whether a public/-relative file exists on disk. */
export function publicFileExists(relPath: string): boolean {
  return existsSync(resolve(PUBLIC_DIR, relPath))
}

export const readIndexHtml = (): string => readRootFile('index.html')

/** Assert `content` references none of the domains we do not own. */
export function expectNoUnownedDomains(content: string): void {
  for (const domain of UNOWNED_DOMAINS) {
    expect(content, `must not reference unowned domain ${domain}`).not.toContain(domain)
  }
}
