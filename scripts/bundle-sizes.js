#!/usr/bin/env node
/**
 * Generates a JSON summary of JS bundle chunk sizes.
 * Output: { chunks: { "ChunkName": bytes, ... }, total: bytes }
 *
 * Chunk names are extracted by stripping the content hash and extension
 * from each .js file in dist/assets/. Workbox runtime files are excluded
 * to match the budget check in CI.
 */
import { readdirSync, statSync, writeFileSync } from 'fs'
import { join, basename } from 'path'

const DIST = join(process.cwd(), 'dist', 'assets')
const OUT = process.argv[2] || 'bundle-sizes.json'

const files = readdirSync(DIST).filter(
  f => f.endsWith('.js') && !f.startsWith('workbox-') && !f.startsWith('sw.')
)

const chunks = {}
let total = 0

for (const file of files) {
  const size = statSync(join(DIST, file)).size
  // Strip hash: "ChunkName-Ab12CdEf.js" → "ChunkName"
  const name = basename(file, '.js').replace(/-[A-Za-z0-9_-]{8,}$/, '')
  chunks[name] = size
  total += size
}

const result = { chunks, total }
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')

const kb = (b) => (b / 1024).toFixed(1)
console.log(`Bundle sizes written to ${OUT}`)
console.log(`Total JS: ${kb(total)} KB across ${files.length} chunks`)
