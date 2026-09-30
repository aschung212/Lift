/**
 * What a share card renders, and the three things every surface derives from it.
 *
 * Until #1018 there was only one answer — a finished session — so the picker,
 * the offscreen rasterizer and the filename all read `summary` directly. A year
 * recap is a second answer, and the three derivations below have to come from
 * the SAME branch as each other: the prop the component is mounted with, the
 * download filename, and the title the OS share sheet shows. That is why this
 * is a discriminated union rather than two optional fields — two optionals let
 * a caller pass both (or neither) and leave each derivation to guess on its own.
 *
 * Pure, so the picker can import it without pulling in the rasterizer.
 */

import { APP_NAME } from './appMeta'
import type { SessionSummary } from './sessionSummary'
import type { YearRecap } from './yearRecap'

export type ShareCardSubject =
  | { kind: 'session'; summary: SessionSummary }
  | { kind: 'recap'; recap: YearRecap }

/**
 * The prop a card component is mounted with.
 *
 * Both the picker's thumbnails and the export pipeline bind through this one
 * function: what you see in the sheet has to be what ships, and a card mounted
 * with a prop it does not declare renders blank — a failure that is only ever
 * visible in the exported PNG, i.e. after the share has already happened.
 */
export function shareCardProps(subject: ShareCardSubject): Record<string, unknown> {
  return subject.kind === 'recap' ? { recap: subject.recap } : { summary: subject.summary }
}

/**
 * Filename stem for the download fallback — the session's local day
 * (`2026-04-21`) or the recap's year (`year-2026`). `defaultShareFilename`
 * adds the app prefix and the story suffix.
 */
export function shareCardFilenameStem(subject: ShareCardSubject): string {
  return subject.kind === 'recap' ? `year-${subject.recap.year}` : subject.summary.rawDate
}

/** Title shown in the OS share sheet for a rasterized card. */
export function shareCardTitle(subject: ShareCardSubject): string {
  return subject.kind === 'recap'
    ? `${APP_NAME} ${subject.recap.year} year in review`
    : `${APP_NAME} workout`
}
