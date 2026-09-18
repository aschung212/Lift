/**
 * LIFT-1435 — the native release guard.
 *
 * `capacitor.config.ts` spread `{ url: process.env.CAPACITOR_DEV_URL, cleartext: true }`
 * into `server` whenever that variable was merely PRESENT in the shell, with no
 * release discriminator. `cap sync` writes the resolved config into
 * `ios/App/App/capacitor.config.json` — gitignored by Capacitor's own
 * `ios/.gitignore`, so never diffed — and the Xcode project copies it into the
 * `.ipa`, where the iOS runtime reads `server.url` from it. An archive cut from
 * the same shell that live-reloads therefore shipped an App Store build loading
 * its entire UI over plaintext HTTP from a LAN address.
 *
 * Two halves are tested here: the guard that reads the EMITTED config (the
 * artifact, not its source — `check-no-dev-surface.js`'s shape), and the
 * `cap:build` wiring, because `VAR=value cmd` binds the assignment to that one
 * command and the `cap sync` step used to run without it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEV_ONLY_SERVER_KEYS,
  NATIVE_PLATFORMS,
  findDevServerSettings,
  inspectNativeConfigs,
  describeDevServer,
  runCheck,
} from '../check-native-release-config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

const IOS = NATIVE_PLATFORMS.find((p) => p.name === 'ios')

let workdir

/** Write a resolved `capacitor.config.json` into a fake synced iOS project. */
function syncIos(config, { withAssets = true } = {}) {
  const target = join(workdir, IOS.config)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(config, null, '\t'))
  if (withAssets) {
    const assets = join(workdir, IOS.assets)
    mkdirSync(dirname(assets), { recursive: true })
    writeFileSync(assets, '<!doctype html><div id="app"></div>')
  }
  return target
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'lift-native-config-'))
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('findDevServerSettings', () => {
  it('flags every dev-only server option that is actively set', () => {
    const findings = findDevServerSettings({
      appId: 'com.aschung212.lift',
      server: {
        url: 'http://192.168.1.42:5173',
        cleartext: true,
        allowNavigation: ['*.example.com'],
      },
    })
    expect(findings.map((f) => f.key).sort()).toEqual(['allowNavigation', 'cleartext', 'url'])
    expect(findings.find((f) => f.key === 'url').value).toBe('http://192.168.1.42:5173')
  })

  it('treats a release config — including one that restates the defaults — as clean', () => {
    expect(findDevServerSettings({ appId: 'com.aschung212.lift', server: {} })).toEqual([])
    expect(findDevServerSettings({ appId: 'com.aschung212.lift' })).toEqual([])
    // `cap copy` writes the config as authored, so an explicit `false` / `[]` is
    // the Capacitor default written out, not a dev-server pointer.
    expect(
      findDevServerSettings({ server: { cleartext: false, allowNavigation: [], iosScheme: 'capacitor' } }),
    ).toEqual([])
  })

  it('does not flag the server options that are legitimate in a release build', () => {
    // hostname / iosScheme / androidScheme / errorPath are production settings:
    // Capacitor's own docs mark only url / cleartext / allowNavigation as not
    // intended for production. Lift sets none of them — `server.iosScheme` is
    // left at its `capacitor` default, which is what makes the bundled app's
    // origin `capacitor://localhost` (#1442: `ios.scheme` is the Xcode BUILD
    // scheme and never produced a URL scheme, so an earlier version of this
    // comment claiming Lift ships `iosScheme: 'Lift'` was doubly wrong) — but a
    // project that did set a custom one must still archive.
    const findings = findDevServerSettings({
      server: { hostname: 'localhost', iosScheme: 'lift', androidScheme: 'https', errorPath: 'error.html' },
    })
    expect(findings).toEqual([])
  })
})

describe('inspectNativeConfigs', () => {
  it('reports the dev-server origin a synced iOS project carries', () => {
    syncIos({ appId: 'com.aschung212.lift', server: { url: 'http://192.168.1.42:5173', cleartext: true } })
    const [ios] = inspectNativeConfigs(workdir)
    expect(ios.platform).toBe('ios')
    expect(ios.findings.map((f) => f.key).sort()).toEqual(['cleartext', 'url'])
  })

  it('passes a release-clean synced project', () => {
    syncIos({ appId: 'com.aschung212.lift', webDir: 'dist', server: {}, ios: { contentInset: 'never' } })
    const [ios] = inspectNativeConfigs(workdir)
    expect(ios.findings).toEqual([])
    expect(ios.missing).toBeUndefined()
    expect(ios.assetsMissing).toBe(false)
  })

  it('reports a platform that was added but never synced', () => {
    // No config file means nothing pins the WebView's origin — inside
    // `cap:build` it means `cap sync` did not actually run.
    mkdirSync(join(workdir, IOS.dir), { recursive: true })
    const [ios] = inspectNativeConfigs(workdir)
    expect(ios.missing).toBe(true)
  })

  it('reports an unparseable config instead of silently passing it', () => {
    const target = join(workdir, IOS.config)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, '{ not json')
    const [ios] = inspectNativeConfigs(workdir)
    expect(ios.unreadable).toBeTruthy()
    expect(ios.findings).toBeUndefined()
  })

  it('reports a clean config whose web bundle was never copied in', () => {
    // The other half of "loads its UI from inside the app": no dev-server origin
    // AND no bundle is a WebView with nothing to show.
    syncIos({ server: {} }, { withAssets: false })
    const [ios] = inspectNativeConfigs(workdir)
    expect(ios.findings).toEqual([])
    expect(ios.assetsMissing).toBe(true)
  })

  it('checks nothing when no native platform has been added', () => {
    expect(inspectNativeConfigs(workdir)).toEqual([])
  })
})

describe('the paths the guard reads are the ones Capacitor writes', () => {
  // Neither file can be committed, so no test can assert on a real one: both are
  // in Capacitor's own `ios/.gitignore`, which is exactly what makes them worth
  // checking — the config is never diffed and never reviewed, and it is what the
  // .ipa ships. That gitignore is generated by `cap add ios`, so it is the
  // closest thing in the repo to Capacitor declaring where it puts them; a
  // future layout change moves both together and lands here.
  const ignored = readFileSync(resolve(ROOT, 'ios', '.gitignore'), 'utf-8')
    .split('\n')
    .map((line) => line.trim())

  it('points at ios/App/App/capacitor.config.json and the copied web bundle', () => {
    expect(ignored).toContain('App/App/capacitor.config.json')
    expect(ignored).toContain('App/App/public')
    expect(IOS.config).toBe(join('ios', 'App', 'App', 'capacitor.config.json'))
    expect(IOS.assets).toBe(join('ios', 'App', 'App', 'public', 'index.html'))
  })
})

describe('describeDevServer', () => {
  it('names the dev server so the sync hook can warn about it', () => {
    syncIos({ server: { url: 'http://192.168.1.42:5173', cleartext: true } })
    expect(describeDevServer(workdir)).toContain('http://192.168.1.42:5173')
  })

  it('is null for a release-clean project', () => {
    syncIos({ server: {} })
    expect(describeDevServer(workdir)).toBeNull()
  })
})

describe('runCheck — the exit code cap:build acts on', () => {
  let logged
  let warned
  let errored

  beforeEach(() => {
    logged = []
    warned = []
    errored = []
    vi.spyOn(console, 'log').mockImplementation((msg) => logged.push(String(msg)))
    vi.spyOn(console, 'warn').mockImplementation((msg) => warned.push(String(msg)))
    vi.spyOn(console, 'error').mockImplementation((msg) => errored.push(String(msg)))
  })

  it('fails the build when the synced config points at a dev server', () => {
    syncIos({ server: { url: 'http://192.168.1.42:5173', cleartext: true } })
    expect(runCheck({ rootDir: workdir })).toBe(1)
    expect(errored.join('\n')).toContain('http://192.168.1.42:5173')
    expect(errored.join('\n')).toContain('cap:build')
  })

  it('passes a release-clean synced project', () => {
    syncIos({ appId: 'com.aschung212.lift', server: {} })
    expect(runCheck({ rootDir: workdir })).toBe(0)
    expect(logged.join('\n')).toContain('loads its UI from inside the app')
  })

  it('fails a platform that was never synced, rather than passing vacuously', () => {
    mkdirSync(join(workdir, IOS.dir), { recursive: true })
    expect(runCheck({ rootDir: workdir })).toBe(1)
    expect(errored.join('\n')).toContain('never been synced')
  })

  it('fails when the web bundle is missing even though the config is clean', () => {
    syncIos({ server: {} }, { withAssets: false })
    expect(runCheck({ rootDir: workdir })).toBe(1)
    expect(errored.join('\n')).toContain('never copied into the native project')
  })

  it('is a no-op when no native platform has been added', () => {
    expect(runCheck({ rootDir: workdir })).toBe(0)
    expect(logged.join('\n')).toContain('no native platform added')
  })

  describe('--warn (the capacitor:sync:after hook)', () => {
    it('names the dev-server origin without failing the sync that created it', () => {
      // Live reload is a supported workflow: the hook runs on EVERY sync, so it
      // must report and step aside. `cap:build`'s final strict run is the gate.
      syncIos({ server: { url: 'http://192.168.1.42:5173', cleartext: true } })
      expect(runCheck({ rootDir: workdir, warnOnly: true })).toBe(0)
      expect(warned.join('\n')).toContain('http://192.168.1.42:5173')
      expect(warned.join('\n')).toContain('cap:build')
    })

    it('says nothing at all on a release-clean sync', () => {
      syncIos({ server: {} })
      expect(runCheck({ rootDir: workdir, warnOnly: true })).toBe(0)
      expect(warned).toEqual([])
      expect(errored).toEqual([])
    })

    it('does not fail a sync for a half-built project', () => {
      // A missing bundle is the release build's business — failing here would
      // break `cap add ios` and any partial sync.
      mkdirSync(join(workdir, IOS.dir), { recursive: true })
      expect(runCheck({ rootDir: workdir, warnOnly: true })).toBe(0)
    })
  })
})

describe('DEV_ONLY_SERVER_KEYS drift (derived from @capacitor/cli)', () => {
  const declarations = readFileSync(
    resolve(ROOT, 'node_modules/@capacitor/cli/dist/declarations.d.ts'),
    'utf-8',
  )

  /** Every documented member of the `server` config block, with its JSDoc. */
  function serverOptionDocs(source) {
    const start = source.indexOf('server?:')
    if (start === -1) throw new Error('declarations.d.ts: no `server?:` member — has @capacitor/cli changed shape?')
    const open = source.indexOf('{', start)
    let depth = 0
    let end = -1
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    if (end === -1) throw new Error('declarations.d.ts: unbalanced `server` block')
    const body = source.slice(open + 1, end)
    if (!body.includes('url?:')) {
      throw new Error('declarations.d.ts: `server` block does not contain `url` — extraction is wrong')
    }
    const docs = []
    const member = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\??:/g
    let match
    while ((match = member.exec(body))) docs.push({ name: match[2], doc: match[1] })
    return docs
  }

  it('covers every server option Capacitor itself marks as not for production', () => {
    const documented = serverOptionDocs(declarations)
    const devOnly = documented
      .filter(({ doc }) => /not intended for use in production/i.test(doc))
      .map(({ name }) => name)

    // Floor, so a doc rewording that breaks the derivation fails here rather
    // than quietly reducing this test to `expect([]).toEqual([])`.
    expect(documented.length).toBeGreaterThan(3)
    expect(devOnly).toContain('url')
    expect(devOnly).toContain('cleartext')

    // A Capacitor upgrade that adds a dev-only `server` option must be added to
    // the guard's list in the same commit — the guard stays hardcoded so a
    // doc-comment rewording can't disarm it mid-build.
    expect([...DEV_ONLY_SERVER_KEYS].sort()).toEqual([...new Set(devOnly)].sort())
  })
})

describe('cap:build wiring', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))

  it('sets CAPACITOR_BUILD=true on EVERY step that resolves capacitor.config.ts', () => {
    // `VAR=value cmd` applies the assignment to that one command, so
    // `CAPACITOR_BUILD=true npm run build && npx cap sync` left `cap sync` —
    // the step that writes the config the .ipa ships — without it. That is the
    // defect: the discriminator existed in vite.config.js and never reached the
    // config resolution that needed it.
    const steps = pkg.scripts['cap:build'].split('&&').map((step) => step.trim())
    const resolvesConfig = steps.filter(
      (step) => /\bcap\s+(sync|copy|update)\b/.test(step) || /\b(npm run build|vite build)\b/.test(step),
    )
    expect(resolvesConfig.length).toBeGreaterThanOrEqual(2)
    for (const step of resolvesConfig) {
      expect(step).toMatch(/^CAPACITOR_BUILD=true\s/)
    }
  })

  it('verifies the emitted config as its last step', () => {
    const steps = pkg.scripts['cap:build'].split('&&').map((step) => step.trim())
    expect(steps.at(-1)).toContain('guard:native-config')
    expect(pkg.scripts['guard:native-config']).toBe('node scripts/check-native-release-config.mjs')
  })

  it('warns from the sync hook, which is the only step that runs on a live-reload sync', () => {
    // `cap:build` cannot see the state a plain `CAPACITOR_DEV_URL=… npx cap sync`
    // leaves behind, and that state is gitignored and outlives the session — an
    // archive taken days later inherits it.
    const hook = pkg.scripts['capacitor:sync:after']
    expect(hook).toContain('node scripts/check-native-release-config.mjs --warn')
    expect(hook).toContain('node scripts/configure-ios.mjs')
  })
})
