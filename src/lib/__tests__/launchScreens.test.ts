/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readRootFile, readIndexHtml, publicFileExists } from './staticArtifacts'
// @ts-expect-error - plain JS generator script, no type declarations
import { DEVICES } from '../../../scripts/generate-launch-screens.js'

/**
 * Regression tests for iOS PWA launch screens (apple-touch-startup-image).
 *
 * On a cold launch from the iOS Home Screen, Safari shows a blank background
 * until the HTML first-paints unless a <link rel="apple-touch-startup-image">
 * tag matches the device resolution. These tests pin that the link tags exist,
 * are well-formed (every iOS-required media feature present), point at PNGs that
 * actually exist in public/launch/, and stay in sync with the generator's
 * device list — so a future edit can't silently drop or mistype a launch image.
 */

const html = readIndexHtml()

interface StartupLink {
  media: string
  href: string
}

function parseStartupLinks(): StartupLink[] {
  const links: StartupLink[] = []
  const re = /<link\s+rel="apple-touch-startup-image"\s+media="([^"]+)"\s+href="([^"]+)"\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    links.push({ media: m[1], href: m[2] })
  }
  return links
}

describe('iOS launch screen (apple-touch-startup-image) regression tests', () => {
  const links = parseStartupLinks()

  it('declares one launch screen per device in the generator list', () => {
    expect(links.length).toBe(DEVICES.length)
  })

  it('every link href references a file that exists in public/launch/', () => {
    for (const { href } of links) {
      expect(href.startsWith('/launch/')).toBe(true)
      expect(publicFileExists(href.replace(/^\//, '')), `${href} missing on disk`).toBe(true)
    }
  })

  it('every media query includes the iOS-required device features', () => {
    for (const { media } of links) {
      expect(media).toContain('device-width:')
      expect(media).toContain('device-height:')
      expect(media).toContain('-webkit-device-pixel-ratio:')
      expect(media).toContain('orientation: portrait')
    }
  })

  it('media queries and filenames match the generator DEVICES (no drift)', () => {
    for (const d of DEVICES as Array<{ dw: number; dh: number; dpr: number }>) {
      const w = d.dw * d.dpr
      const h = d.dh * d.dpr
      const match = links.find((l) => l.href === `/launch/apple-launch-${w}x${h}.png`)
      expect(match, `no <link> for ${d.dw}x${d.dh}@${d.dpr}`).toBeDefined()
      expect(match!.media).toContain(`device-width: ${d.dw}px`)
      expect(match!.media).toContain(`device-height: ${d.dh}px`)
      expect(match!.media).toContain(`-webkit-device-pixel-ratio: ${d.dpr}`)
    }
  })

  it('has no duplicate device-resolution media queries', () => {
    const medias = links.map((l) => l.media)
    expect(new Set(medias).size).toBe(medias.length)
  })

  it('excludes launch screens from the Workbox precache (loaded by Safari, not the app)', () => {
    const viteConfig = readRootFile('vite.config.js')
    expect(viteConfig).toContain("'launch/*.png'")
  })
})
