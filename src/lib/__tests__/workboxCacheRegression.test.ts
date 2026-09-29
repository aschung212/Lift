/// <reference types="node" />
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import {
  loadWorkboxOptions,
  routeFor,
  servesFromCache,
  type RuntimeCachingRule,
  type WorkboxOptions,
} from '../../__tests__/serviceWorkerRoutes'

/**
 * Regression tests for the service worker's runtime routing of Supabase
 * requests, and the rest of the Workbox options vite.config.js sets.
 *
 * These evaluate the config and route real request URLs through it (see
 * serviceWorkerRoutes.ts) instead of slicing its source text around a cache
 * name. The text version could only say a rule existed; it could not say which
 * rule a request LANDS on, and that is how `user_preferences` came to be
 * served from a 24-hour cache (LIFT-1510): no rule named it, so it fell into a
 * NetworkFirst catch-all that no assertion ever routed a request through.
 */

const ROOT = resolve(__dirname, '../../..')
const SUPABASE = 'https://project.supabase.co'
const restUrl = (table: string) => `${SUPABASE}/rest/v1/${table}?select=*&user_id=eq.u1`

/**
 * The tables a cached response is ALLOWED to answer for, each with the merge
 * property that makes a stale read harmless.
 *
 * A cached PostgREST response resolves as `{ data, error: null }` — to a store
 * it is indistinguishable from a fresh row — and a write is a POST the runtime
 * cache never sees, so the cached copy is only ever as new as the last READ.
 * Every change made on this device since then is newer than it. Caching a table
 * is therefore safe only when its merge cannot let that older copy win.
 */
const STALE_TOLERANT: Record<string, string> = {
  sets:
    'merged per exercise by updated_at and unioned by id: a stale page cannot drop a local set, and its copy of '
    + 'one only lands when the owning exercise\'s server row is newer than the local one',
  exercises:
    'last-write-wins on updated_at with ties to local (mergeEntities): a stale row carries a stamp no newer than '
    + 'the one this device already holds, so it loses',
  bodyweight_entries:
    'last-write-wins on updated_at with ties to local (mergeEntities): a stale row carries a stamp no newer than '
    + 'the one this device already holds, so it loses',
}

/**
 * Reads adopted remote-wins with no freshness check. Named rather than left to
 * the default so that caching either one fails with the reason attached.
 */
const NEVER_CACHED: Record<string, string> = {
  user_preferences:
    'the whole blob is adopted by _applyPreferences, and _persistLocal then writes it to localStorage and the '
    + 'FOUC keys — a cached copy reverts every setting changed since, past the end of the outage',
  user_progression:
    'weekly_target, pending_target_change, epoch, show_progression and starter_* are adopted remote-wins, and '
    + '_syncToSupabase then pushes the merged row — a cached copy is written back over the server',
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue)$/.test(name)) out.push(path)
  }
  return out
}

/**
 * Every table the browser client names, derived from `src/` rather than listed:
 * a hardcoded list only covers the tables that existed when it was written, and
 * a table added later is exactly the one nobody thinks to route. (`api/` is
 * server code; its Supabase calls never pass through the service worker.)
 */
const CLIENT_TABLES = [...new Set(
  sourceFiles(join(ROOT, 'src')).flatMap(file =>
    [...readFileSync(file, 'utf8').matchAll(/\.from\(\s*['"`]([a-z0-9_]+)['"`]\s*\)/g)].map(m => m[1])),
)].sort()

let workbox: WorkboxOptions
let rules: RuntimeCachingRule[]

beforeAll(async () => {
  workbox = await loadWorkboxOptions()
  rules = workbox.runtimeCaching ?? []
})

describe('Workbox runtime cache configuration', () => {
  it('evaluates the real runtimeCaching list', () => {
    // Floor: every assertion below is vacuous over an empty rule list.
    expect(rules.length).toBeGreaterThan(0)
  })

  describe('which reads a cached response may answer (LIFT-1510)', () => {
    it('derives the client\'s tables from src/', () => {
      // Floor, so a derivation that silently matches nothing fails here
      // instead of letting every per-table check below pass over nothing.
      for (const table of [...Object.keys(STALE_TOLERANT), ...Object.keys(NEVER_CACHED)]) {
        expect(CLIENT_TABLES, `expected src/ to read ${table}`).toContain(table)
      }
    })

    it('serves a table from a cache only when its merge tolerates a stale read', () => {
      const unjustified = CLIENT_TABLES
        .map(table => ({ table, rule: routeFor(rules, restUrl(table)) }))
        .filter(({ table, rule }) => servesFromCache(rule) && !(table in STALE_TOLERANT))
        .map(({ table, rule }) => `${table} (${String(rule?.handler)})`)
      expect(
        unjustified,
        'A cached response reaches the store as a successful read, so caching a table whose read is adopted '
        + 'remote-wins silently reverts it. Route it NetworkOnly, or add it to STALE_TOLERANT with the merge '
        + 'property that makes a stale copy lose.',
      ).toEqual([])
    })

    it.each(Object.entries(NEVER_CACHED))('never answers a %s read from a cache', (table, why) => {
      const rule = routeFor(rules, restUrl(table))
      expect(rule?.handler, `${table}: ${why}`).toBe('NetworkOnly')
    })

    it('sends a table added later to the network, not to a cache', () => {
      // Caching is opt-in per table. A catch-all that caches is the default
      // that swallowed user_preferences; a new table must start out safe.
      expect(servesFromCache(routeFor(rules, restUrl('a_table_added_later')))).toBe(false)
    })

    it('never routes a write through a runtime cache', () => {
      // Which is why a cached read can only be as new as the last READ: the
      // upsert that carries a local change never refreshes it.
      expect(routeFor(rules, restUrl('user_preferences'), 'POST')).toBeUndefined()
      expect(routeFor(rules, restUrl('sets'), 'POST')).toBeUndefined()
    })

    it('keeps every stale-tolerance verdict true of the current config', () => {
      // A verdict for a table the client no longer reads, or no longer caches,
      // is a justification for nothing — and would quietly pre-approve caching
      // it again later.
      for (const table of Object.keys(STALE_TOLERANT)) {
        expect(CLIENT_TABLES, `STALE_TOLERANT names ${table}, which src/ no longer reads`).toContain(table)
        expect(
          servesFromCache(routeFor(rules, restUrl(table))),
          `STALE_TOLERANT names ${table}, which is no longer cached — drop the verdict`,
        ).toBe(true)
      }
    })

    it('has no caching rule that no client read reaches', () => {
      // The removed progression rule also named xp_events and
      // progression_snapshots, which the client only ever writes.
      const reached = new Set(CLIENT_TABLES.map(table => routeFor(rules, restUrl(table))))
      const dead = rules
        .filter(rule => servesFromCache(rule) && !reached.has(rule))
        .map(rule => String(rule.urlPattern))
      expect(dead).toEqual([])
    })
  })

  describe('endpoint-specific caches', () => {
    it('serves sets StaleWhileRevalidate from a 500-entry cache (100+ exercises × multiple pages)', () => {
      const rule = routeFor(rules, restUrl('sets'))
      expect(rule?.handler).toBe('StaleWhileRevalidate')
      expect(rule?.options?.cacheName).toBe('supabase-sets')
      expect(rule?.options?.expiration?.maxEntries).toBe(500)
    })

    it('serves exercises NetworkFirst from a 200-entry cache', () => {
      const rule = routeFor(rules, restUrl('exercises'))
      expect(rule?.handler).toBe('NetworkFirst')
      expect(rule?.options?.cacheName).toBe('supabase-exercises')
      expect(rule?.options?.expiration?.maxEntries).toBe(200)
    })

    it('serves bodyweight entries NetworkFirst from their own cache', () => {
      const rule = routeFor(rules, restUrl('bodyweight_entries'))
      expect(rule?.handler).toBe('NetworkFirst')
      expect(rule?.options?.cacheName).toBe('supabase-bodyweight')
    })

    it('keeps auth NetworkOnly (never cache tokens)', () => {
      const rule = routeFor(rules, `${SUPABASE}/auth/v1/token?grant_type=refresh_token`)
      expect(rule?.handler).toBe('NetworkOnly')
    })
  })

  describe('rest-timer notification action handler (LIFT-751)', () => {
    it('injects the custom notificationclick handler into the generated SW', () => {
      // Without this importScripts entry, the notification action buttons render
      // but clicking them does nothing (generateSW has no notification handling).
      expect(workbox.importScripts).toContain('sw-notification-handler.js')
    })

    it('ships the handler script that routes the rest-again action', () => {
      const handler = readFileSync(resolve(ROOT, 'public/sw-notification-handler.js'), 'utf-8')
      expect(handler).toContain('notificationclick')
      expect(handler).toContain('rest-again')
      expect(handler).toContain('lift-rest-timer')
    })
  })
})
