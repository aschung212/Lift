/**
 * Plain-language copy for the sync sheet (LIFT-1323).
 *
 * Kept pure and clock-free (`now` is a parameter, like `buildSessionPlan`) so
 * every phrasing decision is unit-testable without mounting anything — the
 * wording IS the feature here. Until this existed the only explanation of a sync
 * failure in the whole app was a `:title` tooltip, which an iOS user has no way
 * to reveal at all.
 *
 * Two rules the strings follow, both learned the hard way:
 *   - Never claim data is backed up when it isn't. LIFT-1310 shipped a guest a
 *     "Synced over encrypted HTTPS" line for data that had never left the
 *     device, so `localOnly` gets its own branch ahead of every other state.
 *   - Say where the data IS, not just that something failed. "Sync failed" alone
 *     reads as "your workout is gone"; the local-first store means it isn't.
 */
import type { SyncStatus } from './syncStatus'

export interface SyncStateCopy {
  /** Headline — the state in the user's terms, not the transport's. */
  title: string
  /** One sentence on what it means for their data, and what happens next. */
  detail: string
}

export interface SyncStateInput {
  /** The folded indicator status (write queue + read errors + stranded). */
  status: SyncStatus
  /** Changes the server does not have: queued, retrying, deferred or stranded. */
  pending: number
  /** Of those, the ones this session has stopped retrying on its own. */
  stranded: number
  /** No account to sync to — a guest, or signed out. */
  localOnly: boolean
}

/** "1 change" / "3 changes" — the count is the point, so it leads. */
export function changeCount(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative wall-clock phrasing for the last confirmed server exchange.
 *
 * A negative delta (device clock moved backwards, or a timestamp from a tab
 * whose clock ran ahead) reads as "Just now" rather than a nonsense future
 * duration — the sheet is reassurance, and "in 3 hours" is the opposite.
 */
export function formatLastSynced(at: number | null, now: number): string {
  if (at === null) return 'Never'
  const delta = now - at
  if (delta < MINUTE) return 'Just now'
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE)
    return `${m} minute${m === 1 ? '' : 's'} ago`
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  if (delta < 7 * DAY) {
    const d = Math.floor(delta / DAY)
    return `${d} day${d === 1 ? '' : 's'} ago`
  }
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Headline + explanation for the current sync state. */
export function describeSyncState({ status, pending, stranded, localOnly }: SyncStateInput): SyncStateCopy {
  if (localOnly) {
    return {
      title: 'Not syncing',
      // Deliberately the same promise App.vue's guest banner makes, so the two
      // surfaces can't contradict each other the way Settings once did.
      detail: 'Your workouts are saved on this device only. Sign in to back them up.',
    }
  }

  if (status === 'offline') {
    return {
      title: 'Offline',
      detail: pending > 0
        ? `${changeCount(pending)} will sync when you're back online.`
        : 'Your workouts are saved on this device until you reconnect.',
    }
  }

  if (status === 'error') {
    if (stranded > 0) {
      return {
        title: "Some changes didn't sync",
        detail: `${changeCount(stranded)} ${stranded === 1 ? 'is' : 'are'} saved on this device but not in your account yet.`,
      }
    }
    return {
      title: 'Sync failed',
      detail: 'Your workouts are saved on this device. Lift will keep trying.',
    }
  }

  // A queued-but-unflushed write leaves `status` at 'synced' for up to the
  // queue's debounce, so it shares the syncing copy rather than claiming the
  // change is already in the account.
  if (status === 'syncing' || pending > 0) {
    return {
      title: 'Syncing',
      detail: pending > 0
        ? `Sending ${changeCount(pending)} to your account.`
        : 'Checking for changes on your other devices.',
    }
  }

  return {
    title: 'Everything is synced',
    detail: 'Your workouts are backed up to your account.',
  }
}
