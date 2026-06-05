/**
 * Catalog of share-card variants for issue #305.
 *
 * The picker UI iterates this registry to render thumbnails. The share flow
 * looks up the component by id. Each entry can declare an `eligible`
 * predicate that hides the card when the summary doesn't fit (e.g. the
 * PR Focus card is hidden when no PRs were set).
 */

import type { Component } from 'vue'
import type { CardFormat } from '../../lib/shareImage'
import type { SessionSummary } from '../../lib/sessionSummary'

import BoldFloodCard from './cards/BoldFloodCard.vue'
import ReceiptCard from './cards/ReceiptCard.vue'
import WeekChartCard from './cards/WeekChartCard.vue'
import BestSetCard from './cards/BestSetCard.vue'
import StatGridCard from './cards/StatGridCard.vue'
import DailyRingCard from './cards/DailyRingCard.vue'
import TicketStubCard from './cards/TicketStubCard.vue'
import PrFocusCard from './cards/PrFocusCard.vue'

import BoldFloodStory from './cards/BoldFloodStory.vue'
import BestSetStory from './cards/BestSetStory.vue'
import WeekChartStory from './cards/WeekChartStory.vue'

export interface CardEntry {
  id: string
  /** Short display name shown under the thumbnail. */
  label: string
  /** Square (1080×1080) or story (1080×1920). */
  format: CardFormat
  /** Returns false to hide this card given the current summary. */
  eligible?: (summary: SessionSummary) => boolean
  component: Component
}

export const SQUARE_CARDS: CardEntry[] = [
  { id: 'bold-flood', label: 'Bold', format: 'square', component: BoldFloodCard },
  { id: 'receipt', label: 'Receipt', format: 'square', component: ReceiptCard },
  { id: 'week-chart', label: 'Week', format: 'square', component: WeekChartCard },
  { id: 'best-set', label: 'Best set', format: 'square', component: BestSetCard },
  { id: 'stat-grid', label: 'Stats', format: 'square', component: StatGridCard },
  { id: 'daily-ring', label: 'Ring', format: 'square', component: DailyRingCard },
  { id: 'ticket-stub', label: 'Ticket', format: 'square', component: TicketStubCard },
  {
    id: 'pr-focus',
    label: 'PR',
    format: 'square',
    component: PrFocusCard,
    eligible: (s) => s.prs > 0 && s.bestSet !== null,
  },
]

export const STORY_CARDS: CardEntry[] = [
  { id: 'bold-flood-story', label: 'Bold', format: 'story', component: BoldFloodStory },
  { id: 'best-set-story', label: 'Best set', format: 'story', component: BestSetStory },
  { id: 'week-chart-story', label: 'Week', format: 'story', component: WeekChartStory },
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
