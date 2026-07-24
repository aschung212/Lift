/**
 * Suggested-caption builder for shared workout cards (#1020).
 *
 * When a user shares a rasterized card, the image carries the numbers but the
 * Web Share `text` field was previously empty — the card landed in a Story or
 * DM with no accompanying copy, so it was neither ready-to-post nor discoverable
 * as UGC. This module produces a short, ready-to-send caption that:
 *   1. gives the cross-poster copy they don't have to write, and
 *   2. seeds the constant branded hashtag (`SHARE_HASHTAG`) so shared cards
 *      cluster under one searchable tag.
 *
 * Framework-free and pure so the share pipeline and tests can call it directly,
 * mirroring `sessionSummary.ts`.
 */

import type { SessionSummary } from './sessionSummary'
import { APP_NAME, SHARE_HASHTAG } from './appMeta'

/**
 * Fold the session's headline stats into a compact "12 sets · 8,450 lbs lifted"
 * phrase. Each part is included only when meaningful so a degenerate/empty
 * summary never emits a bare "0 sets · 0 lbs" line. Returns '' when there's
 * nothing worth stating.
 */
function buildStatLine(summary: SessionSummary): string {
  const parts: string[] = []
  if (summary.setsCompleted > 0) {
    parts.push(`${summary.setsCompleted} ${summary.setsCompleted === 1 ? 'set' : 'sets'}`)
  }
  if (summary.totalVolume > 0) {
    parts.push(`${Math.round(summary.totalVolume).toLocaleString('en-US')} ${summary.unitLabel} lifted`)
  }
  return parts.join(' · ')
}

/**
 * Build the suggested caption pre-filled into the Web Share `text` field for a
 * rasterized workout card. Leads with a PR call-out when the session set one
 * (the most aspirational, high-converting angle), otherwise a neutral logged-a-
 * workout line. Numbers are appended only when present, and the constant branded
 * hashtag always closes the caption.
 *
 * Kept short on purpose: Stories/DM captions truncate, and a single tidy line
 * with one hashtag reads as intentional rather than spammy.
 */
export function workoutShareCaption(summary: SessionSummary): string {
  const headline =
    summary.prs > 0 ? `New PR on ${APP_NAME}!` : `Logged a workout on ${APP_NAME}.`
  const stats = buildStatLine(summary)
  const lead = stats ? `${headline} ${stats}.` : headline
  return `${lead} ${SHARE_HASHTAG}`
}
