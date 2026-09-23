/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { NATIVE_PLATFORMS } from '../../../scripts/check-native-release-config.mjs'

/**
 * Guard: dev-only UI must never ship to production.
 *
 * Two surfaces exist only for local dev and the CI e2e build (VITE_E2E=true):
 *
 *   1. The dev sign-in bypass (LIFT-1123). AuthScreen exposes a "Continue as
 *      Dev" button that calls devSignIn(), which fabricates a
 *      `{ id: 'local-dev' }` session and skips the entire auth gate.
 *   2. The Settings dev tools (#1425): Seed XP, Reset Onboarding, Run
 *      Migration, Clear All Data. They used to be an inline group behind a
 *      localhost/LAN hostname test — and the bundled Capacitor app is served
 *      from capacitor://localhost, so every native install rendered them in a
 *      production bundle. Nothing on the web could see it, and happy-dom's
 *      hostname is localhost too, so no SettingsSheet test could either.
 *
 * Each lives in its own component, lazily imported by its host behind a
 * build-time `import.meta.env.DEV || import.meta.env.VITE_E2E === 'true'`
 * gate, so a normal production build folds the flag to false, tree-shakes the
 * component, and never emits its chunk. An inline `v-if` cannot do that: it
 * compiles into the host's render function and ships in every bundle, merely
 * hidden — which is why the structural half below fails the moment a marker
 * reappears in a host. The only other way in is a misconfigured Vercel env
 * var setting VITE_E2E.
 *
 * These are structural pins (mirroring metaRegression.test.ts). The definitive
 * build-output check — grep the real production dist/ — runs in CI via
 * `npm run guard:dev-surface` (scripts/check-no-dev-surface.js), and is
 * mirrored below whenever a build exists locally.
 *
 * The App Store build is the one bundle no automated environment ever sees
 * (LIFT-1454): `npm run cap:build` runs `vite build` LOCALLY and `cap copy`
 * wipes and replaces `ios/App/App/public` with the result — a tree Capacitor's
 * own `ios/.gitignore` keeps out of git, so it is never diffed and never
 * reviewed. `import.meta.env.DEV` is false under `vite build`, so the leak path
 * is `VITE_E2E` being true in the archiving shell, and Vite reads `.env.local` /
 * `.env.*` for every build. Hence the `--native` half of the script, exercised
 * below against a fixture project.
 */

const root = resolve(__dirname, '../../..')
const srcDir = resolve(root, 'src')

// UI markers unique to each surface. We deliberately do NOT pin
// 'local-dev' / 'dev@localhost': those live in useAuth's devSignIn helper, part
// of the composable's always-bundled API. A class + a label are the strings
// that actually render each surface and that get tree-shaken out with it.
const SURFACES = [
  {
    id: 'dev sign-in bypass (LIFT-1123)',
    host: 'views/AuthScreen.vue',
    component: 'views/DevSignInButton.vue',
    importSpecifier: "import('./DevSignInButton.vue')",
    markers: ['authDevBtn', 'Continue as Dev'],
  },
  {
    id: 'Settings dev tools (#1425)',
    host: 'components/SettingsSheet.vue',
    component: 'views/DevToolsGroup.vue',
    importSpecifier: "import('../views/DevToolsGroup.vue')",
    markers: ['devToolsGrid', 'Seed 80k XP'],
  },
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** Committed source files that render UI (excludes tests). */
function sourceFiles(): string[] {
  return walk(srcDir).filter(
    (file) => /\.(vue|ts)$/.test(file) && !/\.test\.ts$/.test(file),
  )
}

describe.each(SURFACES)('production bundle guard: $id', (surface) => {
  const host = readFileSync(resolve(srcDir, surface.host), 'utf-8')

  describe('source structure keeps the surface tree-shakeable', () => {
    it('the host does not render the surface inline', () => {
      // Inlined, it compiles to an always-present runtime v-if that ships in
      // every bundle. It must live in a separately-chunked component instead.
      for (const marker of surface.markers) {
        expect(host).not.toContain(marker)
      }
    })

    it('the host gates the lazy import behind the build flags', () => {
      expect(host).toContain('import.meta.env.DEV')
      expect(host).toContain('import.meta.env.VITE_E2E')
      expect(host).toContain('defineAsyncComponent')
      expect(host).toContain(surface.importSpecifier)
    })

    it('the host never gates on the hostname (#1425)', () => {
      // capacitor://localhost makes a localhost/LAN test true on every native
      // install; the build flag is the only dev gate.
      expect(host).not.toMatch(/location\s*\.\s*hostname/)
    })

    it('the component still carries the markers (guard is non-vacuous)', () => {
      const component = readFileSync(resolve(srcDir, surface.component), 'utf-8')
      for (const marker of surface.markers) {
        expect(component).toContain(marker)
      }
    })

    it('the component is the ONLY source file that renders the surface', () => {
      const offenders = sourceFiles().filter((file) => {
        if (file.endsWith(surface.component)) return false
        const contents = readFileSync(file, 'utf-8')
        return surface.markers.some((marker) => contents.includes(marker))
      })
      expect(offenders).toEqual([])
    })
  })

  // Mirrors scripts/check-no-dev-surface.js. Only runs when a build exists (it
  // does after `npm run build`; CI enforces the real check in build-and-test).
  describe('built production bundle omits the surface', () => {
    const distDir = resolve(root, 'dist')
    const hasBuild = existsSync(distDir)

    it.runIf(hasBuild)('no emitted JS chunk contains the markers', () => {
      const jsFiles = walk(distDir).filter((f) => f.endsWith('.js'))
      const offenders = jsFiles.filter((file) => {
        const contents = readFileSync(file, 'utf-8')
        return surface.markers.some((marker) => contents.includes(marker))
      })
      expect(offenders).toEqual([])
    })
  })
})

// The script itself, run the way CI runs it. Nothing outside CI executed it
// before, so its contract was unpinned — and LIFT-1169 now depends on the
// directory argument: deploy-production points it at `.vercel/output/static`,
// the tree `vercel deploy --prebuilt` uploads, rather than assuming
// `vercel build` leaves `dist/` behind. Drop the argument handling and that job
// either scans the wrong tree or hard-fails on a missing one.
describe('scripts/check-no-dev-surface.js scans the directory it is given', () => {
  const script = resolve(root, 'scripts/check-no-dev-surface.js')

  function runGuard(...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf-8' })
  }

  function withFixture(js: string, run: (relDir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'lift-guard-'))
    try {
      mkdirSync(join(dir, 'assets'))
      writeFileSync(join(dir, 'assets', 'index-abc123.js'), js)
      run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('passes on a clean bundle in the given directory', () => {
    withFixture('export const a=1;\n', (dir) => {
      const result = runGuard(dir)
      expect(result.status, result.stderr).toBe(0)
    })
  })

  // Without these the case above would pass just as happily against a guard
  // that never opened a file. Driven off SURFACES so a third dev-only surface
  // is covered here by being declared there, rather than by someone
  // remembering to extend a second list.
  it.each(SURFACES)('fails when the given directory carries $id (non-vacuity)', (surface) => {
    withFixture(`const c="${surface.markers[0]}";\n`, (dir) => {
      const result = runGuard(dir)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(surface.markers[0])
    })
  })

  it('fails loudly when the given directory does not exist', () => {
    // A silent pass here would be the worst outcome: CI would report the
    // deployed bundle clean having inspected nothing at all.
    const result = runGuard(join(tmpdir(), 'lift-guard-does-not-exist'))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('not found')
  })

  it('still defaults to dist/ with no argument', () => {
    // build-and-test invokes it bare (`npm run guard:dev-surface`), so the
    // argument LIFT-1169 added must not have displaced the default. Compared
    // against the explicit form rather than asserted on a literal: both runs
    // see the same tree whether or not a build exists locally, so this holds
    // in CI (where dist/ is present) and on a clean checkout (where the
    // matching "not found" message names the path both resolved to).
    const bare = runGuard()
    const explicit = runGuard('dist')
    expect(bare.status).toBe(explicit.status)
    expect(bare.stderr + bare.stdout).toBe(explicit.stderr + explicit.stdout)
  })

  it.runIf(existsSync(resolve(root, 'dist')))('passes against a real build, reporting what it opened', () => {
    // The case above compares two runs of the same code, so it holds just as
    // well if both are broken. This one pins the default path end to end — and
    // the file count with it, since "scanned 0" would mean the guard reported a
    // bundle clean having read nothing.
    const result = runGuard()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(result.stdout).toMatch(/scanned [1-9]\d* JS files/)
  })
})

/**
 * LIFT-1454 — the same guard, pointed at the bundle an archive really carries.
 *
 * Every other run of this script inspects a bundle some automated environment
 * produced: build-and-test's `dist/`, deploy-production's `.vercel/output/static`.
 * `cap:build`'s bundle is built locally and copied into a gitignored native tree,
 * so until this existed the `.ipa` was the one build nothing had ever looked at.
 *
 * The scanned directories come from NATIVE_PLATFORMS rather than a literal in
 * package.json: a second platform is then covered by being declared once, which
 * is the same reason `guard:native-config` reads its config paths from there.
 */
describe('scripts/check-no-dev-surface.js --native scans the bundle the native app ships', () => {
  const script = resolve(root, 'scripts/check-no-dev-surface.js')

  function runNativeGuard(rootDir: string, ...extraArgs: string[]) {
    return spawnSync(process.execPath, [script, '--native', ...extraArgs], {
      encoding: 'utf-8',
      // The convention check-native-release-config.mjs and configure-ios.mjs
      // already use — it is what the Capacitor CLI sets for its own hooks.
      env: { ...process.env, CAPACITOR_ROOT_DIR: rootDir },
    })
  }

  /**
   * A fixture native project. `copiedJs` of `null` models a platform that was
   * added but never `cap copy`-ed, which is the state a sync that silently did
   * nothing leaves behind.
   */
  function withNativeFixture(
    platforms: { platform: (typeof NATIVE_PLATFORMS)[number]; copiedJs: string | null }[],
    run: (rootDir: string) => void,
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'lift-native-guard-'))
    try {
      for (const { platform, copiedJs } of platforms) {
        mkdirSync(join(dir, platform.dir), { recursive: true })
        if (copiedJs === null) continue
        const assets = join(dir, platform.webAssets, 'assets')
        mkdirSync(assets, { recursive: true })
        writeFileSync(join(dir, platform.assets), '<!doctype html><div id="app"></div>')
        writeFileSync(join(assets, 'index-abc123.js'), copiedJs)
      }
      run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const IOS = NATIVE_PLATFORMS.find((p) => p.name === 'ios')!

  it('passes on a clean copied bundle', () => {
    withNativeFixture([{ platform: IOS, copiedJs: 'export const a=1;\n' }], (dir) => {
      const result = runNativeGuard(dir)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('ios')
    })
  })

  // Driven off both lists so a third dev-only surface, or a second native
  // platform, is covered here by being declared rather than by someone
  // remembering to extend a third list.
  it.each(
    NATIVE_PLATFORMS.flatMap((platform) => SURFACES.map((surface) => ({ platform, surface }))),
  )('fails when $platform.name ships $surface.id (non-vacuity)', ({ platform, surface }) => {
    withNativeFixture([{ platform, copiedJs: `const c="${surface.markers[0]}";\n` }], (dir) => {
      const result = runNativeGuard(dir)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(surface.markers[0])
      // Reported relative to the project, i.e. naming the tree that ships.
      expect(result.stderr).toContain(join(platform.webAssets, 'assets', 'index-abc123.js'))
    })
  })

  it('fails when the platform exists but the bundle was never copied in', () => {
    // `cap copy` skips the copy outright when `server.url` is set and webDir is
    // missing, so "synced" does not imply "carries a bundle". Passing here would
    // vouch for a tree that does not exist.
    withNativeFixture([{ platform: IOS, copiedJs: null }], (dir) => {
      const result = runNativeGuard(dir)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(IOS.webAssets)
      expect(result.stderr).toContain('cap:build')
    })
  })

  it('fails when the copied bundle carries no JS at all', () => {
    withNativeFixture([{ platform: IOS, copiedJs: null }], (dir) => {
      mkdirSync(join(dir, IOS.webAssets), { recursive: true })
      writeFileSync(join(dir, IOS.assets), '<!doctype html>')
      const result = runNativeGuard(dir)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('no .js files found')
    })
  })

  it('reports "nothing to check" rather than failing when no platform is added', () => {
    withNativeFixture([], (dir) => {
      const result = runNativeGuard(dir)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('no native platform added')
    })
  })

  // `cap:build` is not the only thing that writes this tree: a bare
  // `npx cap sync` after a VITE_E2E build copies the leak in and leaves a config
  // guard:native-config finds perfectly clean. The hook names it at the moment
  // the sync creates that state — which is gitignored and outlives the session.
  describe('--warn (the capacitor:sync:after hook)', () => {
    it('names a leaked surface without failing the sync', () => {
      const [surface] = SURFACES
      withNativeFixture([{ platform: IOS, copiedJs: `const c="${surface.markers[0]}";\n` }], (dir) => {
        const result = runNativeGuard(dir, '--warn')
        // Live reload and a bare sync are both supported workflows; failing
        // here would break them. cap:build's strict run is the gate.
        expect(result.status, result.stderr).toBe(0)
        expect(result.stderr).toContain(IOS.webAssets)
        expect(result.stderr).toContain('cap:build')
      })
    })

    it('says nothing about a clean bundle', () => {
      withNativeFixture([{ platform: IOS, copiedJs: 'export const a=1;\n' }], (dir) => {
        const result = runNativeGuard(dir, '--warn')
        expect(result.status, result.stderr).toBe(0)
        expect(result.stderr.trim()).toBe('')
      })
    })

    it('says nothing when the copy legitimately did not run', () => {
      // `cap copy` skips the copy outright when `server.url` is set and webDir
      // is missing — the live-reload case, which must not produce a warning.
      withNativeFixture([{ platform: IOS, copiedJs: null }], (dir) => {
        const result = runNativeGuard(dir, '--warn')
        expect(result.status, result.stderr).toBe(0)
        expect(result.stderr.trim()).toBe('')
      })
    })
  })
})

describe('cap:build verifies the bundle it just copied (LIFT-1454)', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
  const steps: string[] = pkg.scripts['cap:build'].split('&&').map((step: string) => step.trim())
  const guardStep = steps.find((step) => step.includes('guard:dev-surface'))

  it('runs the dev-surface guard at all', () => {
    // It did not, for the entire life of the native build: CI ran it against a
    // dist/ built in CI, and cap:build built its own and shipped it unchecked.
    expect(guardStep).toBeDefined()
  })

  it('runs it AFTER the sync, so it reads the copy rather than the copy’s source', () => {
    // Scanning dist/ before the sync verifies the input to the copy and then
    // trusts the copy; the .ipa embeds the copy. Same reason guard:native-config
    // re-reads the EMITTED capacitor.config.json rather than the TypeScript it
    // came from (LIFT-1435).
    const syncIndex = steps.findIndex((step) => /\bcap\s+(sync|copy)\b/.test(step))
    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(steps.findIndex((step) => step.includes('guard:dev-surface'))).toBeGreaterThan(syncIndex)
  })

  it('names --native rather than restating a platform path', () => {
    expect(guardStep).toContain('--native')
    // A literal here is a second copy of something NATIVE_PLATFORMS owns, and
    // it would not reach a platform added later.
    for (const platform of NATIVE_PLATFORMS) {
      expect(guardStep).not.toContain(platform.webAssets)
      expect(guardStep).not.toContain(dirname(platform.assets))
    }
  })

  it('also warns from the sync hook, which is the only step a bare cap sync runs', () => {
    // A `VITE_E2E=true npm run build && npx cap sync` never reaches cap:build's
    // strict step, and leaves a copied bundle carrying the surface behind a
    // capacitor.config.json guard:native-config finds clean.
    expect(pkg.scripts['capacitor:sync:after']).toContain(
      'node scripts/check-no-dev-surface.js --native --warn',
    )
  })
})
