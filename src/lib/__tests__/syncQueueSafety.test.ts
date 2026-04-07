/**
 * Data integrity guard: ensure no non-idempotent operations go through SyncQueue.
 *
 * SyncQueue retries failed operations with exponential backoff. If a non-idempotent
 * operation (like .insert()) is retried after the server already processed it,
 * it could create duplicate data. Only idempotent operations (.upsert(), .update(),
 * .delete()) are safe to retry.
 *
 * This test scans the source code to enforce that invariant. If it fails, either:
 * 1. Change the .insert() to .upsert() (preferred), or
 * 2. Route it directly to Supabase without the syncQueue (fire-and-forget)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

function getStoreFiles(): string[] {
  const storesDir = join(__dirname, '../../stores')
  return readdirSync(storesDir)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => join(storesDir, f))
}

describe('SyncQueue data integrity', () => {
  it('no .insert() calls are routed through syncQueue (non-idempotent, unsafe to retry)', () => {
    const violations: string[] = []

    for (const filePath of getStoreFiles()) {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')

      let insideSyncEnqueue = false
      let enqueueStartLine = 0
      let parenDepth = 0

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        if (line.includes('syncQueue.enqueue')) {
          insideSyncEnqueue = true
          enqueueStartLine = i + 1
          parenDepth = 0
        }

        if (insideSyncEnqueue) {
          for (const ch of line) {
            if (ch === '(') parenDepth++
            if (ch === ')') parenDepth--
          }

          if (line.includes('.insert(')) {
            const fileName = filePath.split('/').pop()
            violations.push(
              `${fileName}:${i + 1} — .insert() inside syncQueue.enqueue (started line ${enqueueStartLine}). ` +
              `Use .upsert() instead, or call Supabase directly without the queue.`
            )
          }

          if (parenDepth <= 0) {
            insideSyncEnqueue = false
          }
        }
      }
    }

    expect(
      violations,
      'Non-idempotent .insert() calls must not go through syncQueue (retries could create duplicates):\n' +
      violations.join('\n')
    ).toHaveLength(0)
  })

  it('no fire-and-forget Supabase calls — all mutations must go through syncQueue', () => {
    const violations: string[] = []

    for (const filePath of getStoreFiles()) {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Match supabase.from(...).insert/upsert/update/delete(...).then()
        // These bypass syncQueue's retry, rate limiting, and error handling.
        if (/supabase[!]?\.from\(/.test(line) || /\)\s*\.then\(\s*\)/.test(line)) {
          // Check if this line or nearby lines have .then() with no callback
          const window = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
          if (/\.(?:insert|upsert|update|delete)\([\s\S]*?\)[\s\S]*?\.then\(\s*\)/.test(window)) {
            const fileName = filePath.split('/').pop()
            violations.push(
              `${fileName}:${i + 1} — fire-and-forget .then() on Supabase call. ` +
              `Route through syncQueue.enqueue() for retry, rate limiting, and error handling.`
            )
          }
        }
      }
    }

    expect(
      violations,
      'Fire-and-forget Supabase calls bypass syncQueue error handling and retries:\n' +
      violations.join('\n')
    ).toHaveLength(0)
  })
})
