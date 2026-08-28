/**
 * Vite plugin: preload the default (Workouts) view chunk.
 *
 * App.vue lazy-loads WorkoutTracker via `defineAsyncComponent`, so the browser
 * only discovers its chunk *after* the main entry script downloads, parses, and
 * Vue mounts — a first-paint request waterfall:
 *
 *   index.html → main entry (js) → App mounts → discover WorkoutTracker → fetch
 *
 * WorkoutTracker is the default tab and always renders on boot, so there's no
 * reason to wait for the entry to execute before starting its download. Emitting
 * a `<link rel="modulepreload">` in the HTML head lets the browser fetch it in
 * parallel with the entry, so the chunk is warm by the time Vue asks for it —
 * collapsing the waterfall to a single round trip.
 *
 * The chunk filename is content-hashed, so we resolve it from the build bundle
 * at transform time rather than hardcoding it (the SEV1 rule: never fabricate an
 * identifier — read the real one from an authoritative source).
 */
import type { Plugin } from 'vite'

/**
 * Matches the container component for the default Workouts tab. Vue SFC module
 * ids carry query suffixes (`WorkoutTracker.vue?vue&type=script…`), so allow an
 * optional `?` after the extension.
 */
const DEFAULT_VIEW_MODULE = /WorkoutTracker\.vue(?:$|\?)/

interface OutputChunkLike {
  type: string
  isDynamicEntry?: boolean
  facadeModuleId?: string | null
  moduleIds?: readonly string[]
}

/**
 * Locate the emitted chunk for the default view.
 * Exported for unit testing — takes the rollup output bundle and returns the
 * hashed filename, or `undefined` if the chunk isn't present.
 *
 * A dynamically-imported Vue SFC has a `null` facadeModuleId (its facade is the
 * `?vue&type=script` sub-module), so we identify the chunk by requiring it to be
 * a dynamic entry that contains the WorkoutTracker.vue module — narrow enough to
 * never match a shared/vendor chunk that merely re-exports it.
 */
export function findDefaultViewChunk(
  bundle: Record<string, OutputChunkLike>,
): string | undefined {
  for (const [fileName, chunk] of Object.entries(bundle)) {
    if (chunk.type !== 'chunk') continue
    const matches =
      (chunk.facadeModuleId && DEFAULT_VIEW_MODULE.test(chunk.facadeModuleId)) ||
      (chunk.isDynamicEntry === true &&
        (chunk.moduleIds ?? []).some((id) => DEFAULT_VIEW_MODULE.test(id)))
    if (matches) return fileName
  }
  return undefined
}

export default function preloadDefaultViewPlugin(): Plugin {
  return {
    name: 'lift-preload-default-view',
    apply: 'build', // Only meaningful for the hashed production bundle.
    transformIndexHtml: {
      // Run after Vite has generated the bundle so `ctx.bundle` is populated.
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html

        const chunkFileName = findDefaultViewChunk(ctx.bundle)
        if (!chunkFileName) return html

        const href = `/${chunkFileName}`
        // Vite may already preload it (it doesn't for async-only chunks today,
        // but guard against double-injection if that ever changes).
        if (html.includes(`href="${href}"`)) return html

        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: { rel: 'modulepreload', crossorigin: true, href },
              injectTo: 'head',
            },
          ],
        }
      },
    },
  }
}
