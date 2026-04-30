/**
 * Structural test: every store's _persist() must call broadcastStoreUpdate().
 *
 * Without this, cross-tab sync silently breaks if someone adds a new store
 * or refactors _persist() without the broadcast call.
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

describe('Cross-tab sync structural integrity', () => {
  it('every store that has _persist() must call broadcastStoreUpdate()', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      // Check if this store has a _persist() method
      if (!content.includes('_persist()')) continue

      // Must import broadcastStoreUpdate
      if (!content.includes('broadcastStoreUpdate')) {
        violations.push(
          `${name} — has _persist() but does not import/call broadcastStoreUpdate. ` +
          `Add: import { broadcastStoreUpdate } from '../lib/crossTabSync' ` +
          `and call broadcastStoreUpdate('<storeName>') inside _persist().`
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('every store that has _persist() must have _reloadFromStorage()', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      if (!content.includes('_reloadFromStorage()')) {
        violations.push(
          `${name} — has _persist() but no _reloadFromStorage(). ` +
          `Cross-tab sync needs this to apply changes from other tabs.`
        )
      }
    }

    expect(violations).toEqual([])
  })
})
