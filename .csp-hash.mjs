import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf-8')
// Match inline <script> blocks that have NO attributes (the theme bootstrap).
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
console.log('inline script count:', matches.length)
for (const m of matches) {
  const body = m[1]
  const hash = createHash('sha256').update(body, 'utf8').digest('base64')
  console.log("sha256-" + hash)
}
