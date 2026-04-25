/**
 * Catalog of share-card variants for issue #305.
 *
 * The picker UI iterates this registry to render thumbnails. The share flow
 * looks up the component by id. New cards land here in subsequent PRs.
 */

import type { Component } from 'vue'
import type { CardFormat } from '../../lib/shareImage'
import type { SessionSummary } from '../../lib/sessionSummary'

import BoldFloodCard from './cards/BoldFloodCard.vue'
import BestSetCard from './cards/BestSetCard.vue'

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
  { id: 'best-set', label: 'Best set', format: 'square', component: BestSetCard },
]

export const STORY_CARDS: CardEntry[] = []

/** Returns the cards that should appear in the picker for this summary. */
export function eligibleSquareCards(summary: SessionSummary): CardEntry[] {
  return SQUARE_CARDS.filter((c) => !c.eligible || c.eligible(summary))
}

/** Look up a card by id, regardless of format bucket. */
export function findCard(id: string): CardEntry | null {
  return SQUARE_CARDS.find((c) => c.id === id) || STORY_CARDS.find((c) => c.id === id) || null
}
