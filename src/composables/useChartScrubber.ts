import { ref, type Ref } from 'vue'
import type { GraphPoint } from './useSVGTimeSeries'

export interface UseChartScrubberReturn {
  /** Index of the point currently under the finger, or null when not scrubbing. */
  activeIndex: Ref<number | null>
  /** True while a touch/pointer drag is in progress. */
  isScrubbing: Ref<boolean>
  onScrubStart: (e: PointerEvent) => void
  onScrubMove: (e: PointerEvent) => void
  onScrubEnd: () => void
}

/**
 * Touch-scrubber for SVG time-series charts. Maps a pointer's client X onto the
 * chart's viewBox space and resolves the nearest data point, exposing its index
 * so the component can render a crosshair + value readout. Matches the iOS-native
 * pattern (Apple Health/Stocks): readout follows the finger and clears on release.
 *
 * `viewBoxWidth` is the chart's SVG viewBox width (it scales to fill its box, so
 * client coordinates must be normalised back into viewBox units).
 */
export function useChartScrubber(
  points: Ref<readonly GraphPoint[]>,
  svgEl: Ref<SVGSVGElement | null>,
  viewBoxWidth: number,
): UseChartScrubberReturn {
  const activeIndex = ref<number | null>(null)
  const isScrubbing = ref(false)

  function clientXToSvgX(clientX: number): number | null {
    const svg = svgEl.value
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return null
    return ((clientX - rect.left) / rect.width) * viewBoxWidth
  }

  function nearestIndex(svgX: number): number | null {
    const pts = points.value
    if (pts.length === 0) return null
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].x - svgX)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  function update(clientX: number) {
    const svgX = clientXToSvgX(clientX)
    if (svgX == null) return
    activeIndex.value = nearestIndex(svgX)
  }

  function onScrubStart(e: PointerEvent) {
    const svg = svgEl.value
    if (svg) {
      try {
        svg.setPointerCapture(e.pointerId)
      } catch {
        /* setPointerCapture can throw on detached/invalid pointers — safe to ignore */
      }
    }
    isScrubbing.value = true
    update(e.clientX)
  }

  function onScrubMove(e: PointerEvent) {
    if (!isScrubbing.value) return
    update(e.clientX)
  }

  function onScrubEnd() {
    isScrubbing.value = false
    activeIndex.value = null
  }

  return { activeIndex, isScrubbing, onScrubStart, onScrubMove, onScrubEnd }
}
