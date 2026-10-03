/**
 * Has this device read the account's row? — the gate on whole-row pushes
 * (LIFT-1515).
 *
 * `user_preferences` and `user_progression` hold ONE row per user, and each
 * store writes it whole: preferences upserts its entire JSONB blob on
 * `unique(user_id)`, progression upserts every column on its `user_id` primary
 * key. A push is therefore only as good as the local copy it carries, and that
 * copy is the account's only once the store has read the server at least once.
 * Before that — a fresh install, a new sign-in, the first sign-in after a
 * sign-out wipe — local state is defaults (or a guest's settings), so a push
 * REPLACES the account's row with them. Nothing used to wait for that read:
 * when it failed (offline, a 5xx, an expired token), the first settings change
 * upserted the default blob over the account's gyms, coach profile, weight unit,
 * presets and PR baseline, and every other device then adopted it remote-wins;
 * a committed set delete ran `removeSetXP`, whose whole-row upsert replaced the
 * account's XP history, streak history and theme unlocks.
 *
 * So the stores hold their push until this module says the row has been read,
 * and replay what was held once it has. The record is persisted per store
 * (`account-row:<store>` → `{ userId, read, heldBase? }`) because the hazard is a
 * property of the DEVICE's copy, not of a session: a device that has read the
 * row keeps pushing immediately across launches, offline included, exactly as
 * before (the durable journal, LIFT-1239, still carries those writes), while a
 * device that never has holds until it does — even if it is relaunched first.
 *
 * `heldBase` is the store's local state at the moment it started holding, kept
 * so the edits made since can be told apart from the defaults they were made
 * on: `heldEditPaths(base, local)` names them and `replayHeldEdits` lays them
 * over the account's copy. It is persisted with the record so an edit made on a
 * launch whose read never succeeded is still replayed by the launch whose read
 * does, instead of being mistaken for part of the base.
 *
 * Only a successful read counts — an adopted/merged row, or PGRST116 ("this
 * account has no row yet", after which pushing local state creates it). A
 * network error, a 5xx, an RLS denial or a 401 leaves the store holding.
 *
 * The record is deliberately NOT mirrored to the IndexedDB backup: a payload
 * restored from backup is re-verified by a read before it may overwrite
 * anything, and the sign-out wipe forgets it before resetting the payload.
 */

/** The stores that write their account's row whole. */
export type WholeRowStore = 'preferences' | 'progression'

interface AccountRowRecord {
  userId: string
  read: boolean
  heldBase?: string
}

/** What a store learns when it binds to an account at `init()`. */
export type AccountRowBinding =
  | { read: true }
  | { read: false; heldBase: string | null }

function storageKey(store: WholeRowStore): string {
  return `account-row:${store}`
}

function readRecord(store: WholeRowStore): AccountRowRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(store))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as Record<string, unknown>
    if (typeof rec.userId !== 'string' || typeof rec.read !== 'boolean') return null
    return {
      userId: rec.userId,
      read: rec.read,
      ...(typeof rec.heldBase === 'string' ? { heldBase: rec.heldBase } : {}),
    }
  } catch {
    // Unreadable or corrupt → "never read": the safe direction, since the only
    // cost is holding pushes until the next successful read.
    return null
  }
}

function writeRecord(store: WholeRowStore, record: AccountRowRecord): void {
  try {
    localStorage.setItem(storageKey(store), JSON.stringify(record))
  } catch {
    // Storage full or unavailable: the store's in-memory flag still governs
    // this session, and the next launch simply holds until its own read.
  }
}

/**
 * Bind a whole-row store to `userId` (its `init()`).
 *
 * Returns `{ read: true }` when this device has already read that account's
 * row. Otherwise the store must hold its pushes, and gets back the base its held
 * edits are measured against: the one an earlier launch persisted for this same
 * user, or — on the first launch to hold — `captureBase()`, persisted now. A
 * record belonging to another user is replaced, never reused.
 */
export function bindAccountRow(
  store: WholeRowStore,
  userId: string,
  captureBase?: () => string,
): AccountRowBinding {
  const record = readRecord(store)
  if (record?.userId === userId && record.read) return { read: true }
  return { read: false, heldBase: holdAccountRow(store, userId, captureBase) }
}

/**
 * Make a whole-row store hold its pushes for `userId` until its next
 * successful read, even on a device that has read the row before. Returns the
 * base the held edits are measured against.
 *
 * `bindAccountRow` holds only a device that has never read the row. A session
 * restored from storage that auth could not refresh (LIFT-1545) needs the same
 * treatment for a different reason: no store is bound to it, so an edit made
 * meanwhile is neither queued nor journaled, and the remote-wins read that
 * runs once the session is confirmed would paint the account's copy over it.
 * Holding records which local values are edits newer than that copy. The base
 * is captured now, before any such edit, unless the store already holds for
 * this user: that earlier base must survive, because the edits made since it
 * are still unsent.
 */
export function holdAccountRow(
  store: WholeRowStore,
  userId: string,
  captureBase?: () => string,
): string | null {
  const record = readRecord(store)
  if (record?.userId === userId && !record.read && (record.heldBase !== undefined || !captureBase)) {
    return record.heldBase ?? null
  }
  const heldBase = captureBase ? captureBase() : null
  writeRecord(store, { userId, read: false, ...(heldBase !== null ? { heldBase } : {}) })
  return heldBase
}

/** Has this device read `userId`'s row? Read-only — for a cross-tab reload. */
export function hasReadAccountRow(store: WholeRowStore, userId: string): boolean {
  const record = readRecord(store)
  return record?.userId === userId && record.read
}

/**
 * Record a successful read of `userId`'s row — adopted, merged, or confirmed
 * absent (PGRST116). Drops the held base: from here on every edit is pushed.
 */
export function markAccountRowRead(store: WholeRowStore, userId: string): void {
  writeRecord(store, { userId, read: true })
}

/** Forget the binding entirely — the sign-out wipe. */
export function forgetAccountRow(store: WholeRowStore): void {
  try {
    localStorage.removeItem(storageKey(store))
  } catch { /* unavailable storage has nothing to forget */ }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The leaf paths where `local` differs from `base` — the edits made while a
 * store was holding.
 *
 * Plain objects are descended so an edit to one experience flag or one coach
 * profile field is replayed alone, without carrying the defaults sitting beside
 * it; arrays and primitives are leaves, compared by JSON value (the payloads are
 * JSON, and arrays like `gyms` are edited as a whole). A key present on only one
 * side is an edit at that key.
 */
export function heldEditPaths(base: unknown, local: unknown, prefix: string[] = []): string[][] {
  if (isPlainRecord(base) && isPlainRecord(local)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local)])
    const paths: string[][] = []
    for (const key of keys) paths.push(...heldEditPaths(base[key], local[key], [...prefix, key]))
    return paths
  }
  return sameValue(base, local) ? [] : [prefix]
}

/**
 * The held edits in `local`, measured against a persisted `heldBase` — none
 * when there is no base (the row was already read) or it no longer parses.
 *
 * A base that can't be read can't tell an edit from a default, and the two
 * failure directions are not symmetric: treating everything as edited would
 * replay a whole device's defaults over the account — the very overwrite this
 * gate exists to stop — while treating nothing as edited only lets the account's
 * copy win, which is what every first read did before LIFT-1515.
 */
export function heldEditsSince(heldBase: string | null, local: Record<string, unknown>): string[][] {
  if (heldBase === null) return []
  let base: unknown
  try {
    base = JSON.parse(heldBase)
  } catch {
    return []
  }
  return isPlainRecord(base) ? heldEditPaths(base, local) : []
}

function valueAt(tree: unknown, path: string[]): unknown {
  let node = tree
  for (const key of path) {
    if (!isPlainRecord(node)) return undefined
    node = node[key]
  }
  return node
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

/**
 * `remote` with every held edit laid on top: each path takes `local`'s value,
 * or is removed where `local` has none. Everything not edited keeps the
 * account's value — that is the whole point.
 *
 * Where the remote side has no object to descend into (a key its older row
 * never carried, or a malformed value), the local subtree is taken whole at
 * that level: there is no account value there to preserve. Returns a new tree;
 * neither input is mutated.
 */
export function replayHeldEdits(
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  paths: string[][],
): Record<string, unknown> {
  const merged = cloneJson(remote)
  for (const path of paths) {
    if (path.length === 0) continue
    let node: Record<string, unknown> = merged
    for (let depth = 0; depth < path.length; depth++) {
      const key = path[depth]
      if (depth === path.length - 1) {
        const value = valueAt(local, path)
        if (value === undefined) delete node[key]
        else node[key] = cloneJson(value)
        break
      }
      const next = node[key]
      if (!isPlainRecord(next)) {
        const localSubtree = valueAt(local, path.slice(0, depth + 1))
        if (localSubtree === undefined) delete node[key]
        else node[key] = cloneJson(localSubtree)
        break
      }
      node = next
    }
  }
  return merged
}
