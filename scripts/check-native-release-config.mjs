#!/usr/bin/env node

/**
 * Release guard: fail if a synced native project loads its web assets from a dev
 * server instead of from inside the app (LIFT-1435).
 *
 * `cap sync` resolves `capacitor.config.ts` and writes the answer into each
 * platform's target directory — `ios/App/App/capacitor.config.json`, which
 * Capacitor's own `ios/.gitignore` keeps out of git and the Xcode project copies
 * into the `.ipa` as a bundle resource. The iOS runtime reads `server.url` from
 * THAT file, so it, and not the TypeScript it came from, is what an archive
 * actually ships.
 *
 * `capacitor.config.ts` now ignores `CAPACITOR_DEV_URL` when
 * `CAPACITOR_BUILD=true`, but that only holds if the variable reaches the
 * `cap sync` step — an npm script, a CI step or a hand-run `npx cap sync` can
 * each drop it, and the resulting project looks identical from the outside. So
 * the emitted file is checked directly: with `server.url` set, WKWebView loads
 * the entire app over plaintext HTTP from a LAN address, which is broken for
 * every user and an App Review flag. Same shape as
 * `scripts/check-no-dev-surface.js` (LIFT-1123 / #1425): gate the source, then
 * verify the artifact.
 *
 * Usage:
 *   node scripts/check-native-release-config.mjs           # = npm run guard:native-config
 *   node scripts/check-native-release-config.mjs --warn    # report, never fail
 *
 * `--warn` is how the `capacitor:sync:after` hook runs it: that hook fires on
 * EVERY sync, including the live-reload one that creates the state, so it is the
 * only automated step that can name the dev-server origin at the moment it
 * appears. It must not fail that sync — live reload is a supported workflow.
 *
 * Exit 0 when every synced platform is release-clean, or when no native platform
 * has been added yet. Exit 1 otherwise.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// `CAPACITOR_ROOT_DIR` is what the Capacitor CLI sets for its own hooks (it runs
// them with the project root as cwd, but the variable is the authoritative
// answer) — honoured here for the same reason scripts/configure-ios.mjs honours
// it, and so a test can point the guard at a fixture project.
const ROOT = resolve(process.env.CAPACITOR_ROOT_DIR || resolve(__dirname, '..'))

/**
 * The `server` options Capacitor's own type docs mark
 * "**This is not intended for use in production.**" (`@capacitor/cli`'s
 * `declarations.d.ts`). Enumerated here so this script stays dependency-free and
 * cannot be disarmed mid-build by a doc-comment rewording; kept honest by
 * `scripts/__tests__/check-native-release-config.test.mjs`, which re-derives the
 * set from those declarations and fails if a Capacitor upgrade adds one this
 * list misses.
 */
export const DEV_ONLY_SERVER_KEYS = Object.freeze(['url', 'cleartext', 'allowNavigation'])

/**
 * Where `cap copy` writes the resolved config and the web bundle, per platform,
 * keyed by the directory whose presence means the platform has been added at all.
 * `android/` is gitignored and currently unused, but the same failure applies
 * there the day it is added, and enumerating it costs one line.
 */
export const NATIVE_PLATFORMS = Object.freeze([
  Object.freeze({
    name: 'ios',
    dir: 'ios',
    config: join('ios', 'App', 'App', 'capacitor.config.json'),
    assets: join('ios', 'App', 'App', 'public', 'index.html'),
  }),
  Object.freeze({
    name: 'android',
    dir: 'android',
    config: join('android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
    assets: join('android', 'app', 'src', 'main', 'assets', 'public', 'index.html'),
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
 * A platform that was never added yields nothing at all. One that was added
 * yields `{ platform, configPath, findings, assetsMissing }`, or
 * `{ ..., missing: true }` / `{ ..., unreadable }` when the emitted config is
 * absent or corrupt — inside `cap:build` either of those means `cap sync` did not
 * actually run, which is its own way of shipping an app that cannot load.
 */
export function inspectNativeConfigs(rootDir = ROOT) {
  const results = []
  for (const platform of NATIVE_PLATFORMS) {
    if (!existsSync(resolve(rootDir, platform.dir))) continue
    const configPath = resolve(rootDir, platform.config)
    const base = { platform: platform.name, configPath: platform.config }
    if (!existsSync(configPath)) {
      results.push({ ...base, missing: true })
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) {
      results.push({ ...base, unreadable: String(err) })
      continue
    }
    results.push({
      ...base,
      findings: findDevServerSettings(parsed),
      // The other half of "loads its UI from inside the app": with no dev-server
      // origin AND no copied bundle, the WebView has nothing to show at all.
      assetsMissing: !existsSync(resolve(rootDir, platform.assets)),
      assetsPath: platform.assets,
    })
  }
  return results
}

/**
 * One line describing the dev server a synced platform points at, or null when
 * no platform carries one. Drives the `--warn` run from the
 * `capacitor:sync:after` hook, which announces the state at the moment a
 * live-reload sync creates it — the last automated step before someone opens
 * Xcode.
 */
export function describeDevServer(rootDir = ROOT) {
  for (const result of inspectNativeConfigs(rootDir)) {
    const url = result.findings?.find((f) => f.key === 'url')
    if (url) return `${result.platform} loads its web assets from ${url.value} (${result.configPath})`
  }
  return null
}

/** Every reason this project is not archivable, as ready-to-print paragraphs. */
export function collectProblems(results) {
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
    if (result.assetsMissing) {
      problems.push(
        `❌ ${result.platform}: ${result.assetsPath} does not exist.\n` +
          `   The web bundle was never copied into the native project, so the WebView\n` +
          `   has nothing to load. Run \`npm run cap:build\`.`,
      )
    }
  }
  return problems
}

/**
 * Run the guard and return the exit code, printing as the CLI does.
 *
 * Returning the code (rather than calling `process.exit` inline) is what lets
 * the test assert the build-failing behaviour directly, without starting a
 * second Node process.
 */
export function runCheck({ rootDir = ROOT, warnOnly = false } = {}) {
  const results = inspectNativeConfigs(rootDir)

  if (warnOnly) {
    // The sync hook: name the dev-server origin at the moment it is created, and
    // never fail — live reload is a supported workflow, and the missing-assets /
    // unreadable-config cases are the release build's business, not this one's.
    const devServer = describeDevServer(rootDir)
    if (devServer) {
      console.warn(
        `[guard:native-config] ⚠️  live-reload config: ${devServer}\n` +
          `[guard:native-config] ⚠️  This project is NOT archivable as-is. Re-run ` +
          `\`npm run cap:build\` before Product → Archive.`,
      )
    }
    return 0
  }

  if (results.length === 0) {
    console.log('[guard:native-config] no native platform added — nothing to check')
    return 0
  }

  const problems = collectProblems(results)
  if (problems.length > 0) {
    console.error(problems.join('\n\n'))
    return 1
  }

  const platforms = results.map((r) => r.platform).join(', ')
  console.log(`✅ Native project loads its UI from inside the app, not a dev server (${platforms}).`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCheck({ rootDir: ROOT, warnOnly: process.argv.includes('--warn') }))
}
