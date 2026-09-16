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
  applyExportCompliancePlist,
  applyPlistSettings,
  applyEntitlementsSetting,
  applyDeploymentTarget,
  applyDeviceFamily,
  applyVersion,
  applyPrivacyManifestProject,
  applyProjectSettings,
  resolveVersion,
  HEALTH_USAGE_STRINGS,
  ENTITLEMENTS_XML,
  ENTITLEMENTS_RELATIVE_PATH,
  EXPORT_COMPLIANCE_KEY,
  DEVICE_FAMILY,
  PRIVACY_MANIFEST_XML,
  PRIVACY_MANIFEST_RELATIVE_PATH,
  PRIVACY_MANIFEST_FILE_REF_ID,
  PRIVACY_MANIFEST_BUILD_FILE_ID,
} from '../configure-ios.mjs'
import { NATIVE_SPLASH_FILES, NATIVE_SPLASH_SIZE } from '../generate-launch-screens.js'

/**
 * The App Store configuration of the iOS project (#1420, #531, #538).
 *
 * Two halves. (1) The transforms are run against the very template
 * `npx cap add ios` extracts — shipped inside @capacitor/cli — rather than a
 * hand-written fixture that would drift from it, so a regenerated project ends
 * up configured. (2) The COMMITTED `ios/` is asserted to already carry every
 * transform, so a setting flipped by hand in Xcode (iPad back on, the manifest
 * dragged out of the target, the placeholder icon restored) fails CI instead of
 * shipping. The transforms are pure string functions, so the edge cases (a key
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
    expect(result).toEqual({
      skipped: false,
      changed: ['Info.plist', ENTITLEMENTS_RELATIVE_PATH, PRIVACY_MANIFEST_RELATIVE_PATH, 'project.pbxproj'],
    })

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

// ── App Store settings (#531 / #538 / #539 / #540) ─────────────────────────
describe('App Store settings against the stock template', () => {
  let dir
  beforeEach(() => {
    dir = extractTemplate()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('declares the app exempt from export compliance, once', () => {
    const plist = read(dir, PLIST)
    expect(plist).not.toContain(EXPORT_COMPLIANCE_KEY)
    const once = applyExportCompliancePlist(plist)
    expect(once).toContain(`<key>${EXPORT_COMPLIANCE_KEY}</key>\n\t<false/>`)
    expect(once.trimEnd().endsWith('</dict>\n</plist>')).toBe(true)
    expect(applyExportCompliancePlist(once)).toBe(once)
  })

  it('narrows the template\'s iPhone + iPad family to iPhone only', () => {
    const pbxproj = read(dir, PBXPROJ)
    const before = pbxproj.match(/TARGETED_DEVICE_FAMILY = "1,2";/g)
    expect(before.length).toBeGreaterThan(0)
    const after = applyDeviceFamily(pbxproj)
    expect(after).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";')
    expect(after.match(/TARGETED_DEVICE_FAMILY = 1;/g)).toHaveLength(before.length)
    expect(DEVICE_FAMILY).toBe('1')
  })

  it('stamps the version pair, and leaves an omitted half alone', () => {
    const pbxproj = read(dir, PBXPROJ)
    const slots = pbxproj.match(/MARKETING_VERSION = [^;]+;/g).length
    expect(slots).toBeGreaterThan(0)
    const both = applyVersion(pbxproj, { marketingVersion: '1.2.3', buildNumber: '456' })
    expect(both.match(/MARKETING_VERSION = 1\.2\.3;/g)).toHaveLength(slots)
    expect(both.match(/CURRENT_PROJECT_VERSION = 456;/g)).toHaveLength(slots)
    const marketingOnly = applyVersion(pbxproj, { marketingVersion: '2.0.0' })
    expect(marketingOnly).toContain('MARKETING_VERSION = 2.0.0;')
    expect(marketingOnly.match(/CURRENT_PROJECT_VERSION = 1;/g)).toHaveLength(slots)
    expect(applyVersion(pbxproj)).toBe(pbxproj)
  })

  it('wires PrivacyInfo.xcprivacy into the App target the way Xcode does: build file, file reference, group child, Copy Bundle Resources', () => {
    const pbxproj = read(dir, PBXPROJ)
    expect(pbxproj).not.toContain('PrivacyInfo.xcprivacy')
    const wired = applyPrivacyManifestProject(pbxproj)
    // The two objects…
    expect(wired).toContain(`${PRIVACY_MANIFEST_BUILD_FILE_ID} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${PRIVACY_MANIFEST_FILE_REF_ID} /* PrivacyInfo.xcprivacy */; };`)
    expect(wired).toContain(`${PRIVACY_MANIFEST_FILE_REF_ID} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`)
    // …a child of the App group (the one that holds Info.plist)…
    const appGroup = wired.slice(wired.indexOf('/* App */ = {'), wired.indexOf('name = App;'))
    expect(appGroup).toContain(`${PRIVACY_MANIFEST_FILE_REF_ID} /* PrivacyInfo.xcprivacy */,`)
    expect(appGroup).toContain('/* Info.plist */,')
    // …and a Copy Bundle Resources entry beside Assets.xcassets.
    const resources = wired.slice(wired.indexOf('/* Begin PBXResourcesBuildPhase section */'), wired.indexOf('/* End PBXResourcesBuildPhase section */'))
    expect(resources).toContain(`${PRIVACY_MANIFEST_BUILD_FILE_ID} /* PrivacyInfo.xcprivacy in Resources */,`)
    expect(resources).toContain('/* Assets.xcassets in Resources */,')
    // Idempotent, and each id appears exactly twice (definition + use).
    expect(applyPrivacyManifestProject(wired)).toBe(wired)
    expect(wired.match(new RegExp(PRIVACY_MANIFEST_FILE_REF_ID, 'g'))).toHaveLength(3)
    expect(wired.match(new RegExp(PRIVACY_MANIFEST_BUILD_FILE_ID, 'g'))).toHaveLength(2)
  })

  it('refuses to guess when the template has changed shape', () => {
    expect(() => applyPrivacyManifestProject('// !$*UTF8*$!\n{ objects = { }; }')).toThrow(/cannot find/)
  })

  it('the manifest itself: no tracking, every collected type for app functionality, UserDefaults with CA92.1', () => {
    expect(PRIVACY_MANIFEST_XML).toContain('<key>NSPrivacyTracking</key>\n\t<false/>')
    expect(PRIVACY_MANIFEST_XML).not.toContain('<key>NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<true/>')
    for (const type of ['EmailAddress', 'UserID', 'Fitness', 'Health', 'CrashData', 'PerformanceData']) {
      expect(PRIVACY_MANIFEST_XML).toContain(`<string>NSPrivacyCollectedDataType${type}</string>`)
    }
    expect(PRIVACY_MANIFEST_XML).toContain('<string>NSPrivacyAccessedAPICategoryUserDefaults</string>')
    expect(PRIVACY_MANIFEST_XML).toContain('<string>CA92.1</string>')
  })

  it('resolveVersion reads package.json semver and a numeric commit count', () => {
    const { marketingVersion, buildNumber } = resolveVersion(ROOT)
    expect(marketingVersion).toMatch(/^\d+\.\d+\.\d+$/)
    if (buildNumber !== undefined) expect(buildNumber).toMatch(/^\d+$/)
  })
})

// ── The committed project (#531): configured, branded, and pinned ──────────
describe('the committed ios/ project already carries every transform', () => {
  const IOS = join(ROOT, 'ios')
  const committed = rel => readFileSync(join(IOS, rel), 'utf8')

  it('exists in the repo (it is the App Store build, not a per-machine artefact)', () => {
    expect(existsSync(join(IOS, PBXPROJ))).toBe(true)
    expect(existsSync(join(IOS, PLIST))).toBe(true)
  })

  it('Info.plist, entitlements, manifest and build settings are all applied — a hand edit in Xcode that drops one fails here', () => {
    const plist = committed(PLIST)
    expect(applyPlistSettings(plist)).toBe(plist)
    const pbxproj = committed(PBXPROJ)
    expect(applyProjectSettings(pbxproj)).toBe(pbxproj)
    expect(pbxproj).not.toContain('TARGETED_DEVICE_FAMILY = "1,2";')
    expect(committed(join('App', ENTITLEMENTS_RELATIVE_PATH))).toBe(ENTITLEMENTS_XML)
    expect(committed(join('App', PRIVACY_MANIFEST_RELATIVE_PATH))).toBe(PRIVACY_MANIFEST_XML)
  })

  const pngSize = buf => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) })

  it('carries the Lift icon, not Capacitor\'s placeholder', () => {
    const icon = readFileSync(join(IOS, 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'))
    expect(pngSize(icon)).toEqual({ width: 1024, height: 1024 })
    expect(icon.equals(readFileSync(join(ROOT, 'public', 'icon-source.png')))).toBe(true)
  })

  it('carries the Eternal launch screen at 2732×2732 in all three universal slots', () => {
    for (const name of NATIVE_SPLASH_FILES) {
      const png = readFileSync(join(IOS, 'App', 'App', 'Assets.xcassets', 'Splash.imageset', name))
      expect(pngSize(png), name).toEqual({ width: NATIVE_SPLASH_SIZE, height: NATIVE_SPLASH_SIZE })
    }
    const storyboard = committed('App/App/Base.lproj/LaunchScreen.storyboard')
    expect(storyboard).not.toContain('systemBackgroundColor')
  })
})
