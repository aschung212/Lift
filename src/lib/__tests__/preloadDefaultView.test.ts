import { describe, it, expect } from 'vitest'
import preloadDefaultViewPlugin, {
  findDefaultViewChunk,
} from '../../../vite-plugin-preload-default-view'

/** Minimal shape of a rollup output bundle entry the plugin cares about. */
type FakeBundle = Record<
  string,
  {
    type: string
    facadeModuleId?: string | null
    isDynamicEntry?: boolean
    moduleIds?: readonly string[]
  }
>

// A dynamically-imported Vue SFC has a null facadeModuleId — its real module
// only shows up in moduleIds (as observed in the actual production bundle), so
// the fixture mirrors that shape.
function makeBundle(): FakeBundle {
  return {
    'assets/index-abc123.js': {
      type: 'chunk',
      facadeModuleId: '/repo/src/main.ts',
    },
    'assets/WorkoutTracker-deadbeef.js': {
      type: 'chunk',
      facadeModuleId: null,
      isDynamicEntry: true,
      moduleIds: [
        '/repo/src/components/WorkoutTracker.vue?vue&type=script&setup=true&lang.ts',
        '/repo/src/components/WorkoutTracker.vue',
      ],
    },
    'assets/CalendarView-cafe01.js': {
      type: 'chunk',
      facadeModuleId: null,
      isDynamicEntry: true,
      moduleIds: ['/repo/src/views/CalendarView.vue'],
    },
    'assets/index-abc123.css': {
      type: 'asset',
    },
  }
}

/** Invoke the plugin's transformIndexHtml handler with a given bundle. */
function runHandler(html: string, bundle: FakeBundle | undefined) {
  const plugin = preloadDefaultViewPlugin()
  const hook = plugin.transformIndexHtml
  // Object-form hook: { order, handler }
  type Handler = (html: string, ctx: unknown) => unknown
  const handler: Handler =
    typeof hook === 'function' ? hook : (hook as { handler: Handler }).handler
  // ctx only needs `bundle` for this plugin.
  return handler(html, { bundle })
}

describe('vite-plugin-preload-default-view', () => {
  it('resolves the hashed WorkoutTracker chunk from a dynamic-entry bundle', () => {
    expect(findDefaultViewChunk(makeBundle())).toBe(
      'assets/WorkoutTracker-deadbeef.js',
    )
  })

  it('resolves via facadeModuleId when one is present', () => {
    const bundle: FakeBundle = {
      'assets/WorkoutTracker-deadbeef.js': {
        type: 'chunk',
        facadeModuleId: '/repo/src/components/WorkoutTracker.vue',
      },
    }
    expect(findDefaultViewChunk(bundle)).toBe('assets/WorkoutTracker-deadbeef.js')
  })

  it('does not match a shared chunk that merely contains the module (not a dynamic entry)', () => {
    const bundle: FakeBundle = {
      'assets/shared-xyz.js': {
        type: 'chunk',
        facadeModuleId: null,
        isDynamicEntry: false,
        moduleIds: ['/repo/src/components/WorkoutTracker.vue'],
      },
    }
    expect(findDefaultViewChunk(bundle)).toBeUndefined()
  })

  it('returns undefined when the default-view chunk is absent', () => {
    const bundle = makeBundle()
    delete bundle['assets/WorkoutTracker-deadbeef.js']
    expect(findDefaultViewChunk(bundle)).toBeUndefined()
  })

  it('ignores asset (non-chunk) entries', () => {
    const bundle: FakeBundle = {
      'assets/WorkoutTracker-deadbeef.css': {
        type: 'asset',
        facadeModuleId: '/repo/src/components/WorkoutTracker.vue',
      },
    }
    expect(findDefaultViewChunk(bundle)).toBeUndefined()
  })

  it('injects a crossorigin modulepreload link for the default view chunk', () => {
    const result = runHandler('<html><head></head><body></body></html>', makeBundle())
    expect(result).toMatchObject({
      tags: [
        {
          tag: 'link',
          attrs: {
            rel: 'modulepreload',
            crossorigin: true,
            href: '/assets/WorkoutTracker-deadbeef.js',
          },
          injectTo: 'head',
        },
      ],
    })
  })

  it('is a no-op when there is no bundle (e.g. dev server)', () => {
    const html = '<html><head></head></html>'
    expect(runHandler(html, undefined)).toBe(html)
  })

  it('does not double-inject if the preload link already exists', () => {
    const html =
      '<html><head><link rel="modulepreload" href="/assets/WorkoutTracker-deadbeef.js"></head></html>'
    expect(runHandler(html, makeBundle())).toBe(html)
  })

  it('only applies during build', () => {
    expect(preloadDefaultViewPlugin().apply).toBe('build')
  })
})
