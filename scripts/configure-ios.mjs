/**
 * Apply Lift's HealthKit configuration to the per-machine iOS project (#1420).
 *
 * `ios/` is generated locally by `npx cap add ios --packagemanager SPM` and is
 * NOT committed (see README → Native iOS build), so anything the native build
 * needs beyond Capacitor's stock template has to be re-applied after generation
 * — and re-applied again whenever the project is regenerated. This script runs
 * from the `capacitor:sync:after` hook in package.json, i.e. on every
 * `npx cap sync` / `npm run cap:build`, and is idempotent:
 *
 *   1. Info.plist gains the two HealthKit usage strings. Without them iOS kills
 *      the app the moment it asks for Health access, and App Review rejects the
 *      build. They are user-facing copy, which is why they are versioned here
 *      rather than typed into Xcode on each machine.
 *   2. App/App.entitlements declares `com.apple.developer.healthkit`, and the App
 *      target's Debug/Release configurations point CODE_SIGN_ENTITLEMENTS at it —
 *      the file-level equivalent of ticking "HealthKit" under Signing &
 *      Capabilities. Xcode reads the capability back from the entitlements file.
 *   3. IPHONEOS_DEPLOYMENT_TARGET is raised to 16.0 (#531), which the README
 *      used to ask for as a manual Xcode step.
 *
 * A no-op (exit 0, one line of output) when `ios/` has not been generated on
 * this machine, so `cap sync` for another platform is unaffected.
 *
 * The transforms are exported so scripts/__tests__/configure-ios.test.mjs can run
 * them against the real Capacitor template.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Copy Apple shows in the HealthKit permission sheet. Keep honest and specific. */
export const HEALTH_USAGE_STRINGS = Object.freeze({
  NSHealthUpdateUsageDescription: 'Lift adds the bodyweight you log to Apple Health.',
  // The sync never asks for read access; this string is required anyway because
  // Lift queries the samples it wrote itself (to avoid writing one twice), and
  // iOS treats any HealthKit query as a read.
  NSHealthShareUsageDescription:
    'Lift checks Health for weigh-ins it already added, so it never adds one twice.',
})

export const ENTITLEMENTS_RELATIVE_PATH = 'App/App.entitlements'

export const ENTITLEMENTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.developer.healthkit</key>
	<true/>
	<key>com.apple.developer.healthkit.access</key>
	<array/>
</dict>
</plist>
`

export const MIN_DEPLOYMENT_TARGET = '16.0'

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Insert any missing usage string before the closing `</dict>` of the top-level
 * Info.plist dictionary. Keys already present (from an earlier run, or hand-set
 * in Xcode) are left exactly as they are.
 */
export function applyHealthUsagePlist(plistXml) {
  let out = plistXml
  for (const [key, value] of Object.entries(HEALTH_USAGE_STRINGS)) {
    if (out.includes(`<key>${key}</key>`)) continue
    const closing = out.lastIndexOf('</dict>')
    if (closing === -1) throw new Error('Info.plist: no closing </dict> found')
    const entry = `\t<key>${key}</key>\n\t<string>${escapeXml(value)}</string>\n`
    out = out.slice(0, closing) + entry + out.slice(closing)
  }
  return out
}

/**
 * Point every build configuration that owns the app's Info.plist at the
 * entitlements file. Only the App target's configurations carry
 * `INFOPLIST_FILE = App/Info.plist;`, so the project-level ones are untouched.
 */
export function applyEntitlementsSetting(pbxproj) {
  if (pbxproj.includes('CODE_SIGN_ENTITLEMENTS')) return pbxproj
  return pbxproj.replace(
    /^(\s*)INFOPLIST_FILE = App\/Info\.plist;$/gm,
    (_, indent) => `${indent}CODE_SIGN_ENTITLEMENTS = ${ENTITLEMENTS_RELATIVE_PATH};\n${indent}INFOPLIST_FILE = App/Info.plist;`,
  )
}

/** Raise (never lower) every IPHONEOS_DEPLOYMENT_TARGET below `minimum`. */
export function applyDeploymentTarget(pbxproj, minimum = MIN_DEPLOYMENT_TARGET) {
  const [minMajor, minMinor = 0] = minimum.split('.').map(Number)
  return pbxproj.replace(/IPHONEOS_DEPLOYMENT_TARGET = (\d+)(?:\.(\d+))?;/g, (match, major, minor = '0') => {
    const below = Number(major) < minMajor || (Number(major) === minMajor && Number(minor) < minMinor)
    return below ? `IPHONEOS_DEPLOYMENT_TARGET = ${minimum};` : match
  })
}

/**
 * Apply every transform to the project under `iosDir` (the `ios/` directory).
 * Returns what changed so a caller (or the test) can assert idempotency.
 */
export function configureIosProject(iosDir) {
  const plistPath = join(iosDir, 'App', 'App', 'Info.plist')
  const pbxprojPath = join(iosDir, 'App', 'App.xcodeproj', 'project.pbxproj')
  const entitlementsPath = join(iosDir, 'App', ENTITLEMENTS_RELATIVE_PATH)
  if (!existsSync(plistPath) || !existsSync(pbxprojPath)) return { skipped: true, changed: [] }

  const changed = []
  const plist = readFileSync(plistPath, 'utf8')
  const nextPlist = applyHealthUsagePlist(plist)
  if (nextPlist !== plist) {
    writeFileSync(plistPath, nextPlist)
    changed.push('Info.plist')
  }

  if (!existsSync(entitlementsPath) || readFileSync(entitlementsPath, 'utf8') !== ENTITLEMENTS_XML) {
    writeFileSync(entitlementsPath, ENTITLEMENTS_XML)
    changed.push(ENTITLEMENTS_RELATIVE_PATH)
  }

  const pbxproj = readFileSync(pbxprojPath, 'utf8')
  const nextPbxproj = applyDeploymentTarget(applyEntitlementsSetting(pbxproj))
  if (nextPbxproj !== pbxproj) {
    writeFileSync(pbxprojPath, nextPbxproj)
    changed.push('project.pbxproj')
  }
  return { skipped: false, changed }
}

function main() {
  const iosDir = resolve(process.env.CAPACITOR_ROOT_DIR || resolve(__dirname, '..'), 'ios')
  const result = configureIosProject(iosDir)
  if (result.skipped) {
    console.log(`[configure-ios] no ios/ project at ${iosDir} — nothing to do (run \`npx cap add ios --packagemanager SPM\` first)`)
    return
  }
  console.log(
    result.changed.length
      ? `[configure-ios] applied HealthKit config: ${result.changed.join(', ')}`
      : '[configure-ios] HealthKit config already applied',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
