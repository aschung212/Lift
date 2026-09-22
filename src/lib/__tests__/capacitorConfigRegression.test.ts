import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
const capacitorConfig = readFileSync(resolve(ROOT, 'capacitor.config.ts'), 'utf-8')

async function loadConfig() {
  vi.resetModules()
  const module = await import('../../../capacitor.config')
  return module.default
}

// The native iOS/Android bundle identifier is an external identifier that must
// never drift or be fabricated (see the SEV1 "never fabricate identifiers" rule
// in CLAUDE.md). `com.aschung212.lift` is a deliberate decision from #216 and is
// the identity the App Store build will ship under — changing it silently would
// orphan an installed app's data and break Capacitor plugin allow-lists.
describe('capacitor.config.ts regression', () => {
  it('pins the iOS/Android appId to the deliberate com.aschung212.lift bundle id', () => {
    expect(capacitorConfig).toContain("appId: 'com.aschung212.lift'")
    // The old placeholder id must never come back.
    expect(capacitorConfig).not.toContain('app.lift.tracker')
  })

  it('keeps appName as Logbook and webDir pointing at the Vite dist bundle', () => {
    expect(capacitorConfig).toContain("appName: 'Logbook'")
    expect(capacitorConfig).toContain("webDir: 'dist'")
  })

  it('lets the page own the safe areas: contentInset never, keyboard resize native (#1423)', () => {
    // The first Simulator run showed a ~93pt white band under the tab bar and
    // a page left shifted after the keyboard closed. Both came from config:
    // contentInset 'automatic' shrank the layout viewport by the safe-area
    // insets the CSS already handles via viewport-fit=cover, and Keyboard
    // resize 'body' rewrote document.body's height around every keyboard.
    // Both values below are Capacitor's defaults; they are pinned because the
    // failure is invisible to every web test and only shows on a device.
    expect(capacitorConfig).toContain("contentInset: 'never'")
    expect(capacitorConfig).not.toContain("contentInset: 'automatic'")
    expect(capacitorConfig).toContain("resize: 'native'")
    expect(capacitorConfig).not.toContain("resize: 'body'")
  })
})

// #1442: `ios.scheme` is the Xcode BUILD scheme passed to `xcodebuild -scheme`,
// not a URL scheme. It read 'Lift' while the committed project's only target —
// and so its only scheme — is `App`, so `npx cap run ios` invoked
// `xcodebuild -scheme Lift` and could not build, `--live-reload` included.
// `cap open ios` + Product → Archive never reads the key, which is why the
// documented App Store flow worked throughout and nothing surfaced this.
//
// The test that used to sit here asserted `scheme: 'Lift'` under the rationale
// "keeps the iOS custom scheme so deep links and StatusBar config resolve" —
// wrong on both counts, since a build scheme reaches neither. That is the reason
// this is worth a derived guard rather than a corrected literal: a test may not
// vouch for a value by restating it, and a hardcoded 'App' would say nothing
// about whether such a scheme exists. Both halves are read from the artifacts
// that actually decide the answer — Capacitor's own declarations for the key's
// meaning and default, and the committed Xcode project for what it can resolve.
describe('capacitor.config.ts iOS build scheme (#1442)', () => {
  const declarations = readFileSync(
    resolve(ROOT, 'node_modules/@capacitor/cli/dist/declarations.d.ts'),
    'utf-8',
  )

  afterEach(() => {
    vi.resetModules()
  })

  /** The balanced `{ … }` body of a top-level `CapacitorConfig` member. */
  function configBlock(source: string, member: string): string {
    const start = source.indexOf(`${member}?:`)
    if (start === -1) {
      throw new Error(`declarations.d.ts: no \`${member}?:\` member — has @capacitor/cli changed shape?`)
    }
    const open = source.indexOf('{', start)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
    }
    throw new Error(`declarations.d.ts: unbalanced \`${member}\` block`)
  }

  /**
   * The `@default` Capacitor documents for one option. Derived rather than
   * assumed so an upgrade that moves a default fails here, instead of leaving
   * this suite asserting against a value the CLI no longer uses.
   *
   * Every documented member is walked and matched by NAME rather than searched
   * for directly: a lazy `/** … *\/ <option>?:` match starts at the first doc
   * comment in the block and happily spans the ones between, so it reports the
   * PRECEDING option's default (`ios.path`'s `ios` for `ios.scheme`,
   * `server.hostname`'s `localhost` for `server.iosScheme`).
   */
  function documentedDefault(source: string, member: string, option: string): string {
    const body = configBlock(source, member)
    const docs = new Map<string, string>()
    const documentedMember = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\??:/g
    let match: RegExpExecArray | null
    while ((match = documentedMember.exec(body))) docs.set(match[2], match[1])
    if (docs.size === 0) throw new Error(`declarations.d.ts: \`${member}\` documents no options`)

    const doc = docs.get(option)
    if (!doc) throw new Error(`declarations.d.ts: \`${member}.${option}\` carries no doc comment`)
    const documented = /@default\s+(\S+)/.exec(doc)
    if (!documented) throw new Error(`declarations.d.ts: \`${member}.${option}\` documents no @default`)
    return documented[1].replace(/^["'`]|["'`]$/g, '')
  }

  /**
   * Every build scheme `xcodebuild -scheme` can resolve against the committed
   * project: the shared ones under `xcshareddata/xcschemes/` (none are committed
   * today), plus the one Xcode autocreates per native target into the gitignored
   * `xcuserdata`. Target names are the checkable proxy for the latter, and are
   * what Capacitor's own docs point at ("usually this matches your app's target
   * in Xcode").
   */
  function resolvableSchemes(): string[] {
    const sharedDir = resolve(ROOT, 'ios/App/App.xcodeproj/xcshareddata/xcschemes')
    const shared = existsSync(sharedDir)
      ? readdirSync(sharedDir)
          .filter((file) => file.endsWith('.xcscheme'))
          .map((file) => file.replace(/\.xcscheme$/, ''))
      : []

    const pbxproj = readFileSync(resolve(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf-8')
    const begin = pbxproj.indexOf('/* Begin PBXNativeTarget section */')
    const end = pbxproj.indexOf('/* End PBXNativeTarget section */')
    if (begin === -1 || end === -1) {
      throw new Error('project.pbxproj: no PBXNativeTarget section — the extraction is wrong')
    }
    const targets = [...pbxproj.slice(begin, end).matchAll(/^\s*name = "?([^";]+)"?;/gm)].map((m) => m[1])
    if (targets.length === 0) throw new Error('project.pbxproj: PBXNativeTarget section names no target')

    return [...new Set([...shared, ...targets])]
  }

  it('resolves to a scheme the committed Xcode project actually has', async () => {
    const config = await loadConfig()
    const schemes = resolvableSchemes()
    // Floor, so a derivation that silently found nothing fails here rather than
    // reducing the assertion below to `expect([]).toContain(undefined)`.
    expect(schemes).toContain('App')

    const resolved = config.ios?.scheme ?? documentedDefault(declarations, 'ios', 'scheme')
    expect(schemes).toContain(resolved)
  })

  it("leaves the key unset, since Capacitor's default is already the only target", async () => {
    // Restating a default is how the wrong value survived review: the key looked
    // like a deliberate setting. Absence resolves to the same scheme and says
    // there is no decision here to get wrong.
    const config = await loadConfig()
    expect(config.ios?.scheme).toBeUndefined()
    expect(documentedDefault(declarations, 'ios', 'scheme')).toBe('App')
  })

  it('keeps the WebView origin at capacitor://localhost — server.iosScheme decides it, ios.scheme never did', async () => {
    // The origin is a DIFFERENT option, and it is load-bearing in three places:
    // #1425's dev-surface gate (a hostname test is true under
    // `capacitor://localhost`, which is why dev tools ship behind build mode),
    // #1430's password reset (a PKCE link can never complete in this origin),
    // and the CORS allow-list the native build has to pass. Leaving
    // `server.iosScheme` unset is what makes all three true.
    const config = await loadConfig()
    expect(config.server?.iosScheme).toBeUndefined()

    const nativeOrigin = `${documentedDefault(declarations, 'server', 'iosScheme')}://localhost`
    expect(nativeOrigin).toBe('capacitor://localhost')
    // The allow-list is hardcoded (it is a server function's CORS gate, not
    // something that can read this config), so a Capacitor upgrade that moved
    // the default origin has to be reconciled with it here.
    expect(readFileSync(resolve(ROOT, 'api/coach.ts'), 'utf-8')).toContain(`'${nativeOrigin}'`)
  })
})

// LIFT-1435: this config decides where the WebView loads the app FROM, so it is
// asserted by EVALUATING it, not by reading it — a text assertion cannot tell a
// gate from a comment about one. `cap sync` resolves this module and writes the
// answer into ios/App/App/capacitor.config.json, which is gitignored, copied
// into the .ipa and read by the iOS runtime, so a CAPACITOR_DEV_URL that
// survives into a release build ships an App Store app whose entire UI comes
// over plaintext HTTP from a LAN address. Both directions matter: the fix must
// not quietly delete live reload either.
describe('capacitor.config.ts dev-server origin (LIFT-1435)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('honours CAPACITOR_DEV_URL for a live-reload build', async () => {
    vi.stubEnv('CAPACITOR_BUILD', undefined)
    vi.stubEnv('CAPACITOR_DEV_URL', 'http://192.168.1.42:5173')
    const config = await loadConfig()
    expect(config.server?.url).toBe('http://192.168.1.42:5173')
    expect(config.server?.cleartext).toBe(true)
  })

  it('ignores CAPACITOR_DEV_URL when CAPACITOR_BUILD=true', async () => {
    vi.stubEnv('CAPACITOR_BUILD', 'true')
    vi.stubEnv('CAPACITOR_DEV_URL', 'http://192.168.1.42:5173')
    const config = await loadConfig()
    expect(config.server?.url).toBeUndefined()
    expect(config.server?.cleartext).toBeUndefined()
  })

  it('leaves the release config free of a dev-server origin when the var is unset', async () => {
    vi.stubEnv('CAPACITOR_BUILD', 'true')
    vi.stubEnv('CAPACITOR_DEV_URL', undefined)
    const config = await loadConfig()
    expect(config.server?.url).toBeUndefined()
    // The rest of the config is unaffected by the discriminator.
    expect(config.appId).toBe('com.aschung212.lift')
    expect(config.ios?.contentInset).toBe('never')
  })
})
