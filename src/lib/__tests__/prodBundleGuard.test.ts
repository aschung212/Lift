/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'

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
})
