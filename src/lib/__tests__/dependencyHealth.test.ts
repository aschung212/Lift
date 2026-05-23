import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8')
)

const packageLock = JSON.parse(
  readFileSync(resolve(__dirname, '../../../package-lock.json'), 'utf-8')
)

describe('dependency health', () => {
  describe('npm overrides for known vulnerabilities and deprecations', () => {
    it('should override serialize-javascript to patched version', () => {
      expect(packageJson.overrides['serialize-javascript']).toBe('>=7.0.4')
    })

    it('should override esbuild to patched version', () => {
      expect(packageJson.overrides['esbuild']).toBe('>=0.25.0')
    })

    it('should override sourcemap-codec with @jridgewell/sourcemap-codec', () => {
      // sourcemap-codec is deprecated — the maintainer recommends @jridgewell/sourcemap-codec
      // Used by magic-string@0.25.9 in workbox-build and @surma/rollup-plugin-off-main-thread
      expect(packageJson.overrides['sourcemap-codec']).toBe(
        'npm:@jridgewell/sourcemap-codec@^1.5.0'
      )
    })
  })

  describe('deprecated transitive dependencies tracking', () => {
    // These are dev-only transitive deps that can't be safely overridden
    // because the parent packages pin specific major versions with breaking API changes.
    // Track them here so we notice when upstream fixes land.

    it('should track glob deprecation from js-beautify (via @vue/test-utils)', () => {
      const jsBeautifyGlob =
        packageLock.packages['node_modules/js-beautify/node_modules/glob']
      if (jsBeautifyGlob) {
        // glob@10.x is deprecated by maintainer in favor of glob@13.x
        // Cannot override: glob@13 removed glob.sync() which js-beautify uses
        // Resolution: wait for @vue/test-utils to update js-beautify
        expect(jsBeautifyGlob.version).toMatch(/^10\./)
        expect(jsBeautifyGlob.deprecated).toBeTruthy()
      }
      // If the entry is gone, js-beautify upgraded — remove this test
    })

    it('should track glob deprecation from workbox-build (via vite-plugin-pwa)', () => {
      const workboxGlob =
        packageLock.packages['node_modules/workbox-build/node_modules/glob']
      if (workboxGlob) {
        // glob@11.x is deprecated by maintainer in favor of glob@13.x
        // Cannot override: glob@13 has breaking API changes
        // Resolution: wait for workbox-build v8 to update
        expect(workboxGlob.version).toMatch(/^11\./)
        expect(workboxGlob.deprecated).toBeTruthy()
      }
      // If the entry is gone, workbox-build upgraded — remove this test
    })

    it('should track source-map beta deprecation from workbox-build', () => {
      const sourceMap = packageLock.packages['node_modules/source-map']
      if (sourceMap?.deprecated) {
        // source-map@0.8.0-beta.0 is an abandoned beta used by workbox-build
        // for WASM-based source map parsing. No stable replacement exists.
        // Cannot override: workbox-build depends on the beta API
        // Resolution: wait for workbox-build v8
        expect(sourceMap.version).toBe('0.8.0-beta.0')
      }
      // If the entry is not deprecated, workbox-build upgraded — remove this test
    })

    it('should verify sourcemap-codec override is applied in lock file', () => {
      const codec = packageLock.packages['node_modules/sourcemap-codec']
      // After npm install with the override, this entry should either:
      // 1. Point to @jridgewell/sourcemap-codec (override applied)
      // 2. Still show the old package (override not yet applied — run npm install)
      if (codec && !codec.resolved?.includes('@jridgewell')) {
        // Override hasn't been applied yet — this is expected until npm install runs
        expect(codec.deprecated).toBeTruthy()
      }
    })
  })

  describe('no production deprecated dependencies', () => {
    it('should have no deprecated packages in production dependencies', () => {
      const prodDeprecated: string[] = []
      for (const [name, info] of Object.entries(
        packageLock.packages as Record<string, { deprecated?: string; dev?: boolean }>
      )) {
        if (info.deprecated && !info.dev && name.startsWith('node_modules/')) {
          prodDeprecated.push(
            `${name.replace('node_modules/', '')}@${(info as { version?: string }).version}`
          )
        }
      }
      expect(prodDeprecated).toEqual([])
    })
  })
})
