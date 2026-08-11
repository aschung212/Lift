// Central registry for the app's inline stroke icons (#1116).
//
// The same 24×24 SVG-stroke icons were hand-inlined dozens of times across
// templates, so a tweak to one copy silently missed the others and every
// duplicate re-shipped its full path string in the compiled render function.
// Each icon is now defined ONCE here and rendered through `AppIcon.vue`, which
// reproduces the canonical wrapper (`viewBox="0 0 24 24"`, `fill="none"`,
// `stroke="currentColor"`). Callers pass only what genuinely varies per usage
// (size, and an optional stroke-width override); the shapes, canonical
// stroke-width, and round-vs-square line caps live with the definition.
//
// Keep the SVG-stroke, 24×24 style mandated by CLAUDE.md when adding icons.

export type IconShape = [tag: string, attrs: Record<string, string | number>]

export interface IconDef {
  /** Inner SVG elements (path/circle/line/polyline/…) drawn inside the 24×24 canvas. */
  shapes: IconShape[]
  /** Canonical stroke width for this glyph; callers may override per usage. */
  strokeWidth: number
  /** Whether the glyph uses round line caps/joins. A handful of icons are square. */
  rounded: boolean
}

export const icons = {
  /** Flame — streak / weekly-goal indicator. */
  flame: {
    shapes: [['path', { d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.5-2.5 1.5-3.5l1 1Z' }]],
    strokeWidth: 2.2,
    rounded: true,
  },
  'chevron-right': {
    shapes: [['path', { d: 'M9 18l6-6-6-6' }]],
    strokeWidth: 2.2,
    rounded: true,
  },
  'chevron-down': {
    shapes: [['polyline', { points: '6 9 12 15 18 9' }]],
    strokeWidth: 2.5,
    rounded: true,
  },
  /** Magnifying glass — search field. */
  search: {
    shapes: [
      ['circle', { cx: 11, cy: 11, r: 8 }],
      ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
  /** House — gym / location. */
  gym: {
    shapes: [
      ['path', { d: 'M3 21h18' }],
      ['path', { d: 'M5 21V7l7-4 7 4v14' }],
      ['path', { d: 'M9 21v-6h6v6' }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
  tag: {
    shapes: [
      ['path', { d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' }],
      ['line', { x1: 7, y1: 7, x2: 7.01, y2: 7 }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
  /** Radiating sun — loading / empty state. */
  sun: {
    shapes: [['path', { d: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' }]],
    strokeWidth: 1.5,
    rounded: true,
  },
  plus: {
    shapes: [
      ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
      ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
    ],
    strokeWidth: 2.5,
    rounded: true,
  },
  /** Line chart trending up. */
  chart: {
    shapes: [
      ['path', { d: 'M3 3v18h18' }],
      ['path', { d: 'M7 15l4-4 3 3 5-6' }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
  /** Clockwise arrow over a clock — history / recent. */
  history: {
    shapes: [
      ['path', { d: 'M3 3v5h5' }],
      ['path', { d: 'M3.05 13A9 9 0 1 0 6 5.3L3 8' }],
      ['path', { d: 'M12 7v5l4 2' }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
  /** Settings cog — square caps to match the original inline copy. */
  gear: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 3 }],
      ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }],
    ],
    strokeWidth: 2,
    rounded: false,
  },
  /** Circled info — square caps to match the original inline copy. */
  info: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['path', { d: 'M12 16v-4' }],
      ['path', { d: 'M12 8h.01' }],
    ],
    strokeWidth: 2,
    rounded: false,
  },
  /** Clock face — rest-timer indicator. */
  clock: {
    shapes: [
      ['circle', { cx: 12, cy: 12, r: 10 }],
      ['polyline', { points: '12 6 12 12 16 14' }],
    ],
    strokeWidth: 2,
    rounded: true,
  },
} satisfies Record<string, IconDef>

export type IconName = keyof typeof icons
