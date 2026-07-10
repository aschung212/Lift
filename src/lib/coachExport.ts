/**
 * AI Coach — "bring your own AI" export (issue #931).
 *
 * The server proxy (`api/coach.ts`) holds the Anthropic key and enforces quota,
 * but that key isn't provisioned yet, so the server flow is dormant. Meanwhile
 * the whole coaching brain is already pure and client-side:
 *   - `buildCoachPayload` builds the training digest on-device,
 *   - `COACH_SYSTEM_PROMPT` is provider-agnostic coaching guidance,
 *   - `buildCoachUserMessage` serializes the payload into a delimited data block.
 *
 * This module composes those into a single ready-to-paste block the user hands
 * to their OWN LLM (Claude, ChatGPT, …). Nothing is sent anywhere by Lift — the
 * user copies or downloads it and chooses where to paste. This is an OPEN loop:
 * the coaching lives in the user's chat; there is no JSON round-trip back into
 * the app (that's why the recommended prompt asks for prose, not the server's
 * fixed `CoachReview` schema).
 *
 * Pure by design (no browser/network/`import.meta`) so it unit-tests directly
 * and the same text is produced everywhere.
 */

import type { CoachPayload } from './aiCoach'
import { COACH_SYSTEM_PROMPT, buildCoachUserMessage } from './aiCoach'

/**
 * Active transport for the Weekly Review.
 *   - `'byo'`  — this module: user pastes into their own LLM. No key, no server.
 *   - `'server'` — the `api/coach.ts` proxy. Flip here once an Anthropic key is
 *     provisioned; the server code path stays intact meanwhile.
 * Kept as a single switch so turning the real backend on is a one-line change,
 * not a rewrite.
 */
export const COACH_MODE: 'byo' | 'server' = 'byo'

/**
 * The recommended prompt shown to (and exported for) the user. Reuses the exact
 * coaching instructions the server sends, then — because this is an open loop
 * read in a chat window, not parsed by the app — asks for readable prose in the
 * feature's four sections instead of the server's JSON schema.
 */
export const RECOMMENDED_COACH_PROMPT = [
  COACH_SYSTEM_PROMPT,
  'Write your review as plain, readable text a lifter can skim on a phone — no JSON, no code blocks, no markdown tables.',
  'Use up to four short sections with these headings, and omit any heading whose signal is weak or absent: "Progress", "Volume", "Consistency", and a final "Focus next" naming the single most useful thing to work on.',
].join('\n\n')

/**
 * The full, copy-paste-ready export: the recommended prompt followed by the
 * training data as a delimited `<data>` block. A user who prefers their own
 * prompt can simply replace everything above the `<data>` block.
 */
export function buildCoachExportText(payload: CoachPayload): string {
  return `${RECOMMENDED_COACH_PROMPT}\n\n${buildCoachUserMessage(payload)}\n`
}

/**
 * Download filename for the export. Caller passes a local date key
 * (`YYYY-MM-DD`, e.g. from `todayISO()`) so this stays pure/testable.
 */
export function coachExportFilename(dateKey: string): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : 'review'
  return `lift-weekly-review-${safe}.md`
}
