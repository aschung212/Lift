import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Structural tests: verify that all Pinia stores broadcast their updates
 * via BroadcastChannel after persisting to localStorage. This prevents
 * regressions where a new store (or refactored _persist) silently drops
 * cross-tab sync.
 */
describe('broadcastSync structural', () => {
  const storesDir = path.resolve(__dirname, '../../stores')
  const storeFiles = fs.readdirSync(storesDir).filter(f => f.endsWith('.ts') && !f.includes('test'))

  for (const file of storeFiles) {
    const content = fs.readFileSync(path.join(storesDir, file), 'utf-8')

    // Only check files that have a _persist() method
    if (!content.includes('_persist()')) continue

    it(`${file}: _persist() calls broadcastStoreUpdate`, () => {
      expect(content).toContain('import')
      expect(content).toContain('broadcastStoreUpdate')

      // Verify the call is inside _persist (rough check: broadcastStoreUpdate appears after _persist)
      const persistIdx = content.indexOf('_persist()')
      const broadcastIdx = content.indexOf('broadcastStoreUpdate', persistIdx)
      expect(broadcastIdx).toBeGreaterThan(persistIdx)
    })

    it(`${file}: has _reloadFromLocalStorage() method`, () => {
      expect(content).toContain('_reloadFromLocalStorage()')
    })
  }

  it('useAuth.ts broadcasts signOut to other tabs', () => {
    const authPath = path.resolve(__dirname, '../../composables/useAuth.ts')
    const content = fs.readFileSync(authPath, 'utf-8')
    expect(content).toContain('broadcastSignOut')
  })

  it('useTheme.ts broadcasts theme changes to other tabs', () => {
    const themePath = path.resolve(__dirname, '../../composables/useTheme.ts')
    const content = fs.readFileSync(themePath, 'utf-8')
    expect(content).toContain('broadcastThemeUpdate')
  })

  it('App.vue sets up cross-tab broadcast listener', () => {
    const appPath = path.resolve(__dirname, '../../App.vue')
    const content = fs.readFileSync(appPath, 'utf-8')
    expect(content).toContain('onBroadcast')
    expect(content).toContain('_reloadFromLocalStorage')
  })
})
