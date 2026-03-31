import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = String(val) }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

vi.mock('../../lib/supabase', () => ({ supabase: null }))

import { useTemplateStore } from '../templates'

describe('templates store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  describe('saveTemplate', () => {
    it('saves a template with exercises', () => {
      const store = useTemplateStore()
      const exercises = [
        { name: 'Bench Press', tags: ['Push', 'Chest'] },
        { name: 'Squat', tags: ['Legs'] },
      ]
      const id = store.saveTemplate('Push Day', exercises)
      expect(id).toBeTruthy()
      expect(store.templates).toHaveLength(1)
      expect(store.templates[0].name).toBe('Push Day')
      expect(store.templates[0].exercises).toHaveLength(2)
      expect(store.templates[0].exercises[0].name).toBe('Bench Press')
    })

    it('returns null for empty name', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('', [{ name: 'Bench', tags: [] }])
      expect(id).toBeNull()
      expect(store.templates).toHaveLength(0)
    })

    it('returns null for empty exercises', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('My Template', [])
      expect(id).toBeNull()
      expect(store.templates).toHaveLength(0)
    })

    it('trims the template name', () => {
      const store = useTemplateStore()
      store.saveTemplate('  Push Day  ', [{ name: 'Bench', tags: [] }])
      expect(store.templates[0].name).toBe('Push Day')
    })

    it('persists to localStorage', () => {
      const store = useTemplateStore()
      store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'workout-templates',
        expect.stringContaining('Test')
      )
    })

    it('deep-copies exercise tags', () => {
      const store = useTemplateStore()
      const tags = ['Push']
      store.saveTemplate('Test', [{ name: 'Bench', tags }])
      tags.push('Mutated')
      expect(store.templates[0].exercises[0].tags).toEqual(['Push'])
    })
  })

  describe('deleteTemplate', () => {
    it('removes a template by id', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      expect(store.templates).toHaveLength(1)
      store.deleteTemplate(id!)
      expect(store.templates).toHaveLength(0)
    })

    it('does nothing for non-existent id', () => {
      const store = useTemplateStore()
      store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      store.deleteTemplate('non-existent')
      expect(store.templates).toHaveLength(1)
    })
  })

  describe('renameTemplate', () => {
    it('renames an existing template', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('Old Name', [{ name: 'Bench', tags: [] }])
      store.renameTemplate(id!, 'New Name')
      expect(store.templates[0].name).toBe('New Name')
    })

    it('trims the new name', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      store.renameTemplate(id!, '  Renamed  ')
      expect(store.templates[0].name).toBe('Renamed')
    })

    it('does nothing for empty name', () => {
      const store = useTemplateStore()
      const id = store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      store.renameTemplate(id!, '')
      expect(store.templates[0].name).toBe('Test')
    })

    it('does nothing for non-existent id', () => {
      const store = useTemplateStore()
      store.saveTemplate('Test', [{ name: 'Bench', tags: [] }])
      store.renameTemplate('non-existent', 'New')
      expect(store.templates[0].name).toBe('Test')
    })
  })

  describe('sortedTemplates', () => {
    it('returns templates sorted by creation date (newest first)', () => {
      const store = useTemplateStore()
      // Manually set different dates
      store.saveTemplate('First', [{ name: 'Bench', tags: [] }])
      store.templates[0].createdAt = '2026-01-01T00:00:00.000Z'
      store.saveTemplate('Second', [{ name: 'Squat', tags: [] }])
      store.templates[1].createdAt = '2026-01-02T00:00:00.000Z'

      const sorted = store.sortedTemplates
      expect(sorted[0].name).toBe('Second')
      expect(sorted[1].name).toBe('First')
    })
  })

  describe('multiple templates', () => {
    it('supports saving multiple templates', () => {
      const store = useTemplateStore()
      store.saveTemplate('Push Day', [{ name: 'Bench', tags: ['Push'] }])
      store.saveTemplate('Pull Day', [{ name: 'Rows', tags: ['Pull'] }])
      store.saveTemplate('Leg Day', [{ name: 'Squat', tags: ['Legs'] }])
      expect(store.templates).toHaveLength(3)
    })

    it('deleting one template does not affect others', () => {
      const store = useTemplateStore()
      store.saveTemplate('Push', [{ name: 'Bench', tags: [] }])
      const id = store.saveTemplate('Pull', [{ name: 'Rows', tags: [] }])
      store.saveTemplate('Legs', [{ name: 'Squat', tags: [] }])
      store.deleteTemplate(id!)
      expect(store.templates).toHaveLength(2)
      expect(store.templates.map(t => t.name)).toEqual(['Push', 'Legs'])
    })
  })
})
