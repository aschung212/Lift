/**
 * Structural test: every store's _persist() must call broadcastStoreUpdate().
 *
 * Without this, changes in one tab won't propagate to others, causing stale
 * data when the same user has Lift open in multiple tabs or a PWA + browser tab.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

function getStoreFiles(): { name: string; content: string }[] {
  const storesDir = join(__dirname, '../../stores')
  return readdirSync(storesDir)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => ({
      name: f,
      content: readFileSync(join(storesDir, f), 'utf-8'),
    }))
}

describe('BroadcastChannel cross-tab sync', () => {
  it('every store with _persist() imports broadcastStoreUpdate', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue
      if (!content.includes('broadcastStoreUpdate')) {
        violations.push(name)
      }
    }

    expect(
      violations,
      `These stores have _persist() but do not call broadcastStoreUpdate:\n${violations.join('\n')}\n\nAdd broadcastStoreUpdate('<storeName>') to _persist() so cross-tab sync works.`
    ).toEqual([])
  })

  it('every store calls broadcastStoreUpdate inside _persist()', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      // Extract _persist method body (rough heuristic: from `_persist()` to next method)
      const persistMatch = content.match(/_persist\(\)\s*\{([\s\S]*?)\n {4}\},/)
      if (!persistMatch) continue

      const persistBody = persistMatch[1]
      if (!persistBody.includes('broadcastStoreUpdate')) {
        violations.push(name)
      }
    }

    expect(
      violations,
      `These stores import broadcastStoreUpdate but don't call it inside _persist():\n${violations.join('\n')}`
    ).toEqual([])
  })
})
