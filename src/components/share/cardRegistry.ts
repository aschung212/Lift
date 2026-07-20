/**
 * Catalog of share-card variants for issue #305.
 *
 * The picker UI iterates this registry to render thumbnails. The share flow
 * looks up the component by id. Each entry can declare an `eligible`
 * predicate that hides the card when the summary doesn't fit (e.g. the
 * PR Focus card is hidden when no PRs were set).
 */

import { defineAsyncComponent, type Component } from 'vue'
import type { CardFormat } from '../../lib/shareImage'
import type { SessionSummary } from '../../lib/sessionSummary'

/**
 * A card component is loaded lazily via dynamic `import()` so the 11 SVG-heavy
 * card `.vue` files are code-split out of the boot bundle and out of the
 * SharePickerSheet chunk (#937). A card's code is only fetched when its
 * thumbnail renders in the picker or when it's rasterized for a share.
 */
type CardLoader = () => Promise<{ default: Component }>

export interface CardEntry {
  id: string
  /** Short display name shown under the thumbnail. */
  label: string
  /** Square (1080×1080) or story (1080×1920). */
  format: CardFormat
  /** Returns false to hide this card given the current summary. */
  eligible?: (summary: SessionSummary) => boolean
  /** Dynamically imports the card component (lazy, code-split per card). */
  loader: CardLoader
}

export const SQUARE_CARDS: CardEntry[] = [
  { id: 'bold-flood', label: 'Bold', format: 'square', loader: () => import('./cards/BoldFloodCard.vue') },
  { id: 'receipt', label: 'Receipt', format: 'square', loader: () => import('./cards/ReceiptCard.vue') },
  { id: 'week-chart', label: 'Week', format: 'square', loader: () => import('./cards/WeekChartCard.vue') },
  { id: 'best-set', label: 'Best set', format: 'square', loader: () => import('./cards/BestSetCard.vue') },
  { id: 'stat-grid', label: 'Stats', format: 'square', loader: () => import('./cards/StatGridCard.vue') },
  { id: 'daily-ring', label: 'Ring', format: 'square', loader: () => import('./cards/DailyRingCard.vue') },
  { id: 'ticket-stub', label: 'Ticket', format: 'square', loader: () => import('./cards/TicketStubCard.vue') },
  {
    id: 'pr-focus',
    label: 'PR',
    format: 'square',
    loader: () => import('./cards/PrFocusCard.vue'),
    eligible: (s) => s.prs > 0 && s.bestSet !== null,
  },
]

export const STORY_CARDS: CardEntry[] = [
  { id: 'bold-flood-story', label: 'Bold', format: 'story', loader: () => import('./cards/BoldFloodStory.vue') },
  { id: 'best-set-story', label: 'Best set', format: 'story', loader: () => import('./cards/BestSetStory.vue') },
  { id: 'week-chart-story', label: 'Week', format: 'story', loader: () => import('./cards/WeekChartStory.vue') },
]

/**
 * Returns the eligible square cards in display order, with PR Focus
 * promoted to the front when there's a real PR — the moment is the
 * moment, per the handoff spec.
 */
export function eligibleSquareCards(summary: SessionSummary): CardEntry[] {
  const eligible = SQUARE_CARDS.filter((c) => !c.eligible || c.eligible(summary))
  const prIdx = eligible.findIndex((c) => c.id === 'pr-focus')
  if (prIdx > 0) {
    const [prCard] = eligible.splice(prIdx, 1)
    eligible.unshift(prCard)
  }
  return eligible
}

/** Story-format cards in display order. PR-focus story isn't part of v1. */
export function eligibleStoryCards(summary: SessionSummary): CardEntry[] {
  return STORY_CARDS.filter((c) => !c.eligible || c.eligible(summary))
}

/** Look up a card by id, regardless of format bucket. */
export function findCard(id: string): CardEntry | null {
  return SQUARE_CARDS.find((c) => c.id === id) || STORY_CARDS.find((c) => c.id === id) || null
}

/**
 * Async component wrappers for rendering card thumbnails in the picker.
 * Memoized per id so Vue sees a stable component identity across re-renders
 * (a fresh `defineAsyncComponent` each render would remount the thumbnail).
 */
const asyncComponentCache = new Map<string, Component>()

/** Returns the lazily-loaded async component for a card id (for the picker). */
export function cardComponent(id: string): Component | null {
  const cached = asyncComponentCache.get(id)
  if (cached) return cached
  const entry = findCard(id)
  if (!entry) return null
  const comp = defineAsyncComponent(entry.loader)
  asyncComponentCache.set(id, comp)
  return comp
}

/**
 * Resolves a card id to its concrete component (awaiting the dynamic import).
 * The offscreen rasterizer needs the real component so it renders synchronously
 * before capture — an unresolved async wrapper would rasterize a blank frame.
 */
export async function loadCardComponent(id: string): Promise<Component | null> {
  const entry = findCard(id)
  if (!entry) return null
  const mod = await entry.loader()
  return mod.default
}

/**
 * Resolve a card id to the format bucket and active index the picker should
 * open on. Used by the contextual share entry points (e.g. the "Share this PR"
 * button on the PR celebration overlay, #716) to pre-select a specific card.
 *
 * Returns null when the id is unknown, or when the card exists but isn't
 * eligible for this summary (so callers fall back to the default first card).
 */
export function resolveInitialCard(
  summary: SessionSummary,
  cardId: string,
): { format: CardFormat; index: number } | null {
  const card = findCard(cardId)
  if (!card) return null
  const list = card.format === 'square' ? eligibleSquareCards(summary) : eligibleStoryCards(summary)
  const index = list.findIndex((c) => c.id === cardId)
  if (index < 0) return null
  return { format: card.format, index }
}
