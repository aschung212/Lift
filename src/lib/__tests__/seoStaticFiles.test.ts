/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const DEPLOYMENT_DOMAIN = 'spa-rho-sandy.vercel.app'
const publicDir = resolve(__dirname, '../../../public')

describe('robots.txt', () => {
  const robotsPath = resolve(publicDir, 'robots.txt')

  it('exists in public directory', () => {
    expect(existsSync(robotsPath)).toBe(true)
  })

  it('allows all user agents', () => {
    const content = readFileSync(robotsPath, 'utf-8')
    expect(content).toContain('User-agent: *')
    expect(content).toContain('Allow: /')
  })

  it('references sitemap.xml with real deployment domain', () => {
    const content = readFileSync(robotsPath, 'utf-8')
    expect(content).toContain(`Sitemap: https://${DEPLOYMENT_DOMAIN}/sitemap.xml`)
  })

  it('does not reference liftracker.app', () => {
    const content = readFileSync(robotsPath, 'utf-8')
    expect(content).not.toContain('liftracker.app')
  })
})

describe('sitemap.xml', () => {
  const sitemapPath = resolve(publicDir, 'sitemap.xml')

  it('exists in public directory', () => {
    expect(existsSync(sitemapPath)).toBe(true)
  })

  it('is valid XML with urlset namespace', () => {
    const content = readFileSync(sitemapPath, 'utf-8')
    expect(content).toContain('<?xml version="1.0"')
    expect(content).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })

  it('contains root URL with real deployment domain', () => {
    const content = readFileSync(sitemapPath, 'utf-8')
    expect(content).toContain(`<loc>https://${DEPLOYMENT_DOMAIN}</loc>`)
  })

  it('does not reference liftracker.app', () => {
    const content = readFileSync(sitemapPath, 'utf-8')
    expect(content).not.toContain('liftracker.app')
  })

  it('all loc URLs use HTTPS', () => {
    const content = readFileSync(sitemapPath, 'utf-8')
    const locs = content.match(/<loc>(.*?)<\/loc>/g) ?? []
    for (const loc of locs) {
      expect(loc).toMatch(/https:\/\//)
    }
  })
})
