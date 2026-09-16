#!/usr/bin/env node

/**
 * Release guard: fail if a synced native project loads its web assets from a
 * dev server (LIFT-1435).
 *
 * `cap sync` resolves `capacitor.config.ts` and writes the answer into each
 * platform's target directory — `ios/App/App/capacitor.config.json`, which
 * Capacitor's own `ios/.gitignore` keeps out of git and the Xcode project copies
 * into the `.ipa` as a bundle resource. That file is what the iOS runtime reads
 * `server.url` from, so it, and not the TypeScript it came from, is the thing an
 * archive actually ships.
 *
 * `capacitor.config.ts` now ignores `CAPACITOR_DEV_URL` when
 * `CAPACITOR_BUILD=true`, but that only holds if the variable reaches the
 * `cap sync` step — an npm script, a CI step or a hand-run `npx cap sync` can
 * each drop it, and the resulting bundle looks identical from the outside. So
 * the emitted file is checked directly: with `server.url` set, WKWebView loads
 * the entire app over plaintext HTTP from a LAN address, which is broken for
 * every user and an App Review flag. Same shape as
 * `scripts/check-no-dev-surface.js` (LIFT-1123 / #1425): gate the config, then
 * verify the artifact.
 *
 * Usage:
 *   node scripts/check-native-release-config.mjs   # = npm run guard:native-config
 *
 * Exit 0 when every synced platform config is release-clean, or when no native
 * platform has been added yet. Exit 1 on the first offender.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// `CAPACITOR_ROOT_DIR` is what the Capacitor CLI sets for its own hooks (see
// scripts/configure-ios.mjs) — honoured for the same reason, and so the test can
// point the CLI at a fixture project.
const ROOT = resolve(process.env.CAPACITOR_ROOT_DIR || resolve(__dirname, '..'))

/**
 * The `server` options Capacitor's own type docs mark
 * "**This is not intended for use in production.**" (`@capacitor/cli`'s
 * `declarations.d.ts`). Enumerated here so this script stays dependency-free and
 * can't be broken by a doc-comment rewording mid-build; kept honest by
 * `scripts/__tests__/check-native-release-config.test.mjs`, which re-derives the
 * set from those declarations and fails if a Capacitor upgrade adds one this
 * list misses.
 */
export const DEV_ONLY_SERVER_KEYS = Object.freeze(['url', 'cleartext', 'allowNavigation'])

/**
 * Where `cap copy` writes the resolved config, per platform, keyed by the
 * directory whose presence means the platform has been added at all.
 */
export const NATIVE_PLATFORMS = Object.freeze([
  Object.freeze({ name: 'ios', dir: 'ios', config: join('ios', 'App', 'App', 'capacitor.config.json') }),
  Object.freeze({
    name: 'android',
    dir: 'android',
    config: join('android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
  }),
])

/**
 * An option counts as "set" only when it would actually change the WebView's
 * behaviour. Capacitor writes the config object as authored, so an explicit
 * `cleartext: false` or an empty `allowNavigation: []` is the default restated,
 * not a dev-server pointer.
 */
function isActive(value) {
  if (value === undefined || value === null || value === false || value === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

/** Every dev-only `server` option actively set in a resolved config object. */
export function findDevServerSettings(config) {
  const server = config && typeof config === 'object' ? config.server : undefined
  if (!server || typeof server !== 'object') return []
  return DEV_ONLY_SERVER_KEYS.filter((key) => isActive(server[key])).map((key) => ({
    key,
    value: server[key],
  }))
}

/**
 * Inspect every native platform present under `rootDir`.
 *
 * Each result is `{ platform, configPath, findings }` for a platform that has
 * been synced, `{ platform, configPath, missing: true }` for one that has been
 * added but never synced (the caller decides whether that is an error — inside
 * `cap:build` it means `cap sync` did not run), and nothing at all for a
 * platform that was never added.
 */
export function inspectNativeConfigs(rootDir = ROOT) {
  const results = []
  for (const platform of NATIVE_PLATFORMS) {
    if (!existsSync(resolve(rootDir, platform.dir))) continue
    const configPath = resolve(rootDir, platform.config)
    if (!existsSync(configPath)) {
      results.push({ platform: platform.name, configPath: platform.config, missing: true })
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) {
      results.push({ platform: platform.name, configPath: platform.config, unreadable: String(err) })
      continue
    }
    results.push({
      platform: platform.name,
      configPath: platform.config,
      findings: findDevServerSettings(parsed),
    })
  }
  return results
}

/**
 * One line describing the dev server a synced platform points at, or null when
 * it is release-clean. Used by `scripts/configure-ios.mjs` (the
 * `capacitor:sync:after` hook) to announce the state at the moment a live-reload
 * sync creates it — the last automated step before someone opens Xcode.
 */
export function describeDevServer(rootDir = ROOT) {
  for (const result of inspectNativeConfigs(rootDir)) {
    const url = result.findings?.find((f) => f.key === 'url')
    if (url) return `${result.platform} loads its web assets from ${url.value} (${result.configPath})`
  }
  return null
}

function main() {
  const results = inspectNativeConfigs(ROOT)

  if (results.length === 0) {
    console.log('[guard:native-config] no native platform added — nothing to check')
    return
  }

  const problems = []
  for (const result of results) {
    if (result.missing) {
      problems.push(
        `❌ ${result.platform}: ${result.configPath} does not exist.\n` +
          `   The platform is present but has never been synced, so nothing pins the\n` +
          `   WebView's asset origin. Run \`npm run cap:build\`.`,
      )
      continue
    }
    if (result.unreadable) {
      problems.push(`❌ ${result.platform}: ${result.configPath} is not valid JSON (${result.unreadable}).`)
      continue
    }
    if (result.findings.length > 0) {
      const settings = result.findings
        .map(({ key, value }) => `server.${key} = ${JSON.stringify(value)}`)
        .join('\n     ')
      problems.push(
        `❌ ${result.platform}: ${result.configPath} points the app at a dev server:\n` +
          `     ${settings}\n` +
          `   A build archived from this project loads its entire UI from that address,\n` +
          `   not from the assets inside the app. Re-sync with \`npm run cap:build\`\n` +
          `   (which sets CAPACITOR_BUILD=true, so CAPACITOR_DEV_URL is ignored), or\n` +
          `   unset CAPACITOR_DEV_URL. See LIFT-1435.`,
      )
    }
  }

  if (problems.length > 0) {
    console.error(problems.join('\n\n'))
    process.exit(1)
  }

  const platforms = results.map((r) => r.platform).join(', ')
  console.log(`✅ No dev-server origin in the synced native config (${platforms}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
