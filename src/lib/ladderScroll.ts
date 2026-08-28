/**
 * Horizontal-only scrolling for the routine-ladder chip row (#780).
 *
 * The log-set modal keeps the highlighted "next" rung chip visible as the user
 * works up the ladder. That nudge must be PURELY horizontal — the chips live in
 * a horizontally-scrolling row (`.wtPrevSessionChips`) nested inside the
 * vertically-scrolling modal (`.repMaxModal`).
 *
 * The old implementation used `Element.scrollIntoView({ block: 'nearest' })`,
 * which scrolls EVERY scroll ancestor. With the keyboard up and the modal
 * scrolled down to the inputs (chip row off the top), saving a set yanked the
 * modal back up to reveal the chip and pushed the weight/reps inputs — and the
 * just-saved confirmation — off-screen. This helper computes only the horizontal
 * delta, which the caller applies via `container.scrollBy`, leaving vertical
 * scroll untouched.
 */

/** The horizontal extent (in viewport px) of an element — `getBoundingClientRect`'s left/right. */
export interface HorizontalBounds {
  left: number
  right: number
}

/**
 * Horizontal scroll delta (px, for `scrollBy`'s `left`) that brings `el` fully
 * inside `container` with `inset` breathing room at each edge. Returns:
 *   - a negative value when the chip sits off the left edge (scroll left),
 *   - a positive value when it sits off the right edge (scroll right),
 *   - 0 when it is already visible (no scroll — never disturbs the row).
 *
 * Mirrors `scrollIntoView({ inline: 'nearest' })`: the chip is moved to the
 * NEAREST edge, not centered, so an already-visible chip never jumps.
 */
export function ladderChipScrollLeft(
  container: HorizontalBounds,
  el: HorizontalBounds,
  inset = 16,
): number {
  if (el.left < container.left + inset) {
    return el.left - container.left - inset
  }
  if (el.right > container.right - inset) {
    return el.right - container.right + inset
  }
  return 0
}
