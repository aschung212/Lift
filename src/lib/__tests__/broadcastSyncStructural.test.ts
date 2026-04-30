import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const STORES_DIR = path.resolve(__dirname, '../../stores')

const STORE_FILES = ['workout.ts', 'bodyweight.ts', 'preferences.ts', 'progression.ts']

describe('broadcastSync structural', () => {
  for (const file of STORE_FILES) {
    const storeName = file.replace('.ts', '')
    const content = fs.readFileSync(path.join(STORES_DIR, file), 'utf-8')

    it(`${storeName} store imports broadcastStoreUpdate`, () => {
      expect(content).toContain("import { broadcastStoreUpdate } from '../lib/broadcastSync'")
    })

    it(`${storeName} store calls broadcastStoreUpdate in _persist()`, () => {
      // Find the _persist method and verify it contains broadcastStoreUpdate
      const persistMatch = content.match(/_persist\(\)[\s\S]*?(?=\n {4}\w)/)
      expect(persistMatch).not.toBeNull()
      expect(persistMatch![0]).toContain('broadcastStoreUpdate')
    })

    it(`${storeName} store has _reloadFromStorage() action`, () => {
      expect(content).toContain('_reloadFromStorage()')
    })
  }
})
