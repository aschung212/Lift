import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useChartScrubber } from '../useChartScrubber'
import type { GraphPoint } from '../useSVGTimeSeries'

const VIEWBOX_W = 320

function makePoints(xs: number[]): GraphPoint[] {
  return xs.map((x, i) => ({ x, y: 50, date: `2025-01-0${i + 1}`, value: i }))
}

/** Fake SVG element whose rect maps client px 1:1 to a 320-wide viewBox. */
function fakeSvg(width = VIEWBOX_W, left = 0): SVGSVGElement {
  return {
    getBoundingClientRect: () => ({ left, width, top: 0, right: left + width, bottom: 0, height: 0, x: left, y: 0 }),
    setPointerCapture: () => {},
  } as unknown as SVGSVGElement
}

function pointer(clientX: number): PointerEvent {
  return { clientX, pointerId: 1 } as PointerEvent
}

describe('useChartScrubber', () => {
  it('starts with no active point', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg())
    const { activeIndex, isScrubbing } = useChartScrubber(points, svg, VIEWBOX_W)
    expect(activeIndex.value).toBe(null)
    expect(isScrubbing.value).toBe(false)
  })

  it('resolves the nearest point on scrub start', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg())
    const { activeIndex, isScrubbing, onScrubStart } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubStart(pointer(150))
    expect(isScrubbing.value).toBe(true)
    expect(activeIndex.value).toBe(1) // 150 is closest to 160
  })

  it('tracks the nearest point as the finger moves', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg())
    const { activeIndex, onScrubStart, onScrubMove } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubStart(pointer(60))
    expect(activeIndex.value).toBe(0)
    onScrubMove(pointer(300))
    expect(activeIndex.value).toBe(2)
  })

  it('ignores move events when not scrubbing', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg())
    const { activeIndex, onScrubMove } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubMove(pointer(300))
    expect(activeIndex.value).toBe(null)
  })

  it('clears the active point on scrub end', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg())
    const { activeIndex, isScrubbing, onScrubStart, onScrubEnd } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubStart(pointer(150))
    expect(activeIndex.value).toBe(1)
    onScrubEnd()
    expect(activeIndex.value).toBe(null)
    expect(isScrubbing.value).toBe(false)
  })

  it('maps client coordinates through a scaled / offset rect', () => {
    // Chart rendered 640px wide (2x) at left offset 100 → viewBox is half client px.
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref(fakeSvg(640, 100))
    const { activeIndex, onScrubStart } = useChartScrubber(points, svg, VIEWBOX_W)
    // clientX 420 → (420-100)/640*320 = 160 → nearest is index 1
    onScrubStart(pointer(420))
    expect(activeIndex.value).toBe(1)
  })

  it('does nothing useful when the svg ref is null', () => {
    const points = ref(makePoints([56, 160, 304]))
    const svg = ref<SVGSVGElement | null>(null)
    const { activeIndex, onScrubStart, isScrubbing } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubStart(pointer(150))
    // Still marked scrubbing, but no coordinate could be resolved
    expect(isScrubbing.value).toBe(true)
    expect(activeIndex.value).toBe(null)
  })

  it('returns null index when there are no points', () => {
    const points = ref<GraphPoint[]>([])
    const svg = ref(fakeSvg())
    const { activeIndex, onScrubStart } = useChartScrubber(points, svg, VIEWBOX_W)
    onScrubStart(pointer(150))
    expect(activeIndex.value).toBe(null)
  })
})
