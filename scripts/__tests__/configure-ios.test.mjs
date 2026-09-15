// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  configureIosProject,
  applyHealthUsagePlist,
  applyEntitlementsSetting,
  applyDeploymentTarget,
  HEALTH_USAGE_STRINGS,
  ENTITLEMENTS_XML,
  ENTITLEMENTS_RELATIVE_PATH,
} from '../configure-ios.mjs'

/**
 * The HealthKit configuration for the per-machine iOS project (#1420).
 *
 * `ios/` is generated and gitignored, so the only way to test that the native
 * build gets its usage strings, entitlement and deployment target is to run the
 * script against the very template `npx cap add ios` extracts — shipped inside
 * @capacitor/cli — rather than against a hand-written fixture that would drift
 * from it. The transforms are pure string functions, so the edge cases (a key
 * hand-set in Xcode, an already-higher target, a second run) are pinned directly.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const TEMPLATE = join(ROOT, 'node_modules', '@capacitor', 'cli', 'assets', 'ios-spm-template.tar.gz')

function extractTemplate() {
  const dir = mkdtempSync(join(tmpdir(), 'lift-ios-template-'))
  execFileSync('tar', ['xzf', TEMPLATE, '-C', dir])
  return dir
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8')
const PLIST = 'App/App/Info.plist'
const PBXPROJ = 'App/App.xcodeproj/project.pbxproj'

describe('configureIosProject against the stock Capacitor iOS template', () => {
  let dir
  beforeEach(() => {
    dir = extractTemplate()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies the usage strings, the entitlement and the build settings', () => {
    const before = read(dir, PLIST)
    expect(before).not.toContain('NSHealthUpdateUsageDescription')
    expect(read(dir, PBXPROJ)).toContain('IPHONEOS_DEPLOYMENT_TARGET = 15.0;')

    const result = configureIosProject(dir)
    expect(result).toEqual({ skipped: false, changed: ['Info.plist', ENTITLEMENTS_RELATIVE_PATH, 'project.pbxproj'] })

    const plist = read(dir, PLIST)
    for (const [key, value] of Object.entries(HEALTH_USAGE_STRINGS)) {
      expect(plist).toContain(`<key>${key}</key>\n\t<string>${value}</string>`)
    }
    // Inserted inside the top-level dict, so the file still ends the way a plist must.
    expect(plist.trimEnd().endsWith('</dict>\n</plist>')).toBe(true)

    expect(read(dir, join('App', ENTITLEMENTS_RELATIVE_PATH))).toBe(ENTITLEMENTS_XML)
    expect(ENTITLEMENTS_XML).toContain('<key>com.apple.developer.healthkit</key>\n\t<true/>')

    const pbxproj = read(dir, PBXPROJ)
    const infoPlistRefs = pbxproj.match(/INFOPLIST_FILE = App\/Info\.plist;/g).length
    expect(infoPlistRefs).toBeGreaterThan(0)
    expect(pbxproj.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(infoPlistRefs)
    expect(pbxproj).not.toContain('IPHONEOS_DEPLOYMENT_TARGET = 15.0;')
    expect(pbxproj.match(/IPHONEOS_DEPLOYMENT_TARGET = 16\.0;/g).length).toBeGreaterThanOrEqual(infoPlistRefs)
  })

  it('is idempotent: a second run changes nothing', () => {
    configureIosProject(dir)
    const snapshot = [PLIST, PBXPROJ, join('App', ENTITLEMENTS_RELATIVE_PATH)].map(rel => read(dir, rel))
    expect(configureIosProject(dir)).toEqual({ skipped: false, changed: [] })
    expect([PLIST, PBXPROJ, join('App', ENTITLEMENTS_RELATIVE_PATH)].map(rel => read(dir, rel))).toEqual(snapshot)
  })

  it('skips cleanly when the project has not been generated on this machine', () => {
    const empty = mkdtempSync(join(tmpdir(), 'lift-no-ios-'))
    try {
      expect(configureIosProject(empty)).toEqual({ skipped: true, changed: [] })
      expect(existsSync(join(empty, 'App'))).toBe(false)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('applyHealthUsagePlist', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Lift</string>
\t<key>UIApplicationSceneManifest</key>
\t<dict>
\t\t<key>UIApplicationSupportsMultipleScenes</key>
\t\t<false/>
\t</dict>
</dict>
</plist>
`

  it('inserts both keys into the TOP-LEVEL dict, not the last nested one', () => {
    const out = applyHealthUsagePlist(plist)
    const nestedEnd = out.indexOf('\t</dict>')
    const shareKey = out.indexOf('<key>NSHealthShareUsageDescription</key>')
    expect(shareKey).toBeGreaterThan(nestedEnd)
    expect(out.match(/<key>NSHealth\w+UsageDescription<\/key>/g)).toHaveLength(2)
  })

  it('leaves a key that was hand-set in Xcode exactly as it is and adds only the missing one', () => {
    const handSet = plist.replace(
      '</dict>\n</plist>',
      '\t<key>NSHealthUpdateUsageDescription</key>\n\t<string>Custom copy from Xcode</string>\n</dict>\n</plist>',
    )
    const out = applyHealthUsagePlist(handSet)
    expect(out).toContain('<string>Custom copy from Xcode</string>')
    expect(out).not.toContain(HEALTH_USAGE_STRINGS.NSHealthUpdateUsageDescription)
    expect(out.match(/NSHealthUpdateUsageDescription/g)).toHaveLength(1)
    expect(out).toContain(`<string>${HEALTH_USAGE_STRINGS.NSHealthShareUsageDescription}</string>`)
  })

  it('escapes XML in the usage copy', () => {
    for (const value of Object.values(HEALTH_USAGE_STRINGS)) expect(value).not.toMatch(/[<>&]/)
    expect(applyHealthUsagePlist(plist)).not.toContain('&amp;') // nothing to escape today
  })
})

describe('applyEntitlementsSetting / applyDeploymentTarget', () => {
  it('points every app-target configuration at the entitlements file, once', () => {
    const pbx = '\t\t\t\tINFOPLIST_FILE = App/Info.plist;\n\t\t\t\tOTHER = 1;\n\t\t\t\tINFOPLIST_FILE = App/Info.plist;\n'
    const once = applyEntitlementsSetting(pbx)
    expect(once.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2)
    expect(once).toContain('\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\tINFOPLIST_FILE = App/Info.plist;')
    expect(applyEntitlementsSetting(once)).toBe(once)
  })

  it('raises a lower deployment target and never lowers a higher one', () => {
    const pbx = 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nIPHONEOS_DEPLOYMENT_TARGET = 16.0;\nIPHONEOS_DEPLOYMENT_TARGET = 17.2;\nIPHONEOS_DEPLOYMENT_TARGET = 14;\n'
    expect(applyDeploymentTarget(pbx)).toBe(
      'IPHONEOS_DEPLOYMENT_TARGET = 16.0;\nIPHONEOS_DEPLOYMENT_TARGET = 16.0;\nIPHONEOS_DEPLOYMENT_TARGET = 17.2;\nIPHONEOS_DEPLOYMENT_TARGET = 16.0;\n',
    )
  })
})

describe('wiring', () => {
  it('runs from the capacitor:sync:after hook, so it survives every regeneration', () => {
    // A typo in the hook name would silently never run: Capacitor only looks
    // for the exact script names in package.json.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['capacitor:sync:after']).toBe('node scripts/configure-ios.mjs')
    expect(pkg.scripts['cap:configure:ios']).toBe('node scripts/configure-ios.mjs')
    expect(existsSync(join(ROOT, 'scripts', 'configure-ios.mjs'))).toBe(true)
  })

  it('the native plugin is a runtime dependency so cap sync links it', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@capgo/capacitor-health']).toBeDefined()
    expect(pkg.dependencies['@capacitor/ios']).toBeDefined()
  })
})
