import { defineStore } from 'pinia'
import { uuid } from '../lib/uuid'

const STORAGE_KEY = 'workout-templates'

export interface TemplateExercise {
  name: string
  tags: string[]
}

export interface WorkoutTemplate {
  id: string
  name: string
  exercises: TemplateExercise[]
  createdAt: string
}

function load(): WorkoutTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useTemplateStore = defineStore('templates', {
  state: () => ({
    templates: load() as WorkoutTemplate[],
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.templates))
    },

    saveTemplate(name: string, exercises: TemplateExercise[]): string | null {
      const trimmed = name.trim()
      if (!trimmed || exercises.length === 0) return null
      const id = uuid()
      this.templates.push({
        id,
        name: trimmed,
        exercises: exercises.map(e => ({ name: e.name, tags: [...e.tags] })),
        createdAt: new Date().toISOString(),
      })
      this._persist()
      return id
    },

    deleteTemplate(id: string) {
      this.templates = this.templates.filter(t => t.id !== id)
      this._persist()
    },

    renameTemplate(id: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      const template = this.templates.find(t => t.id === id)
      if (!template) return
      template.name = trimmed
      this._persist()
    },
  },

  getters: {
    sortedTemplates: (state): WorkoutTemplate[] => {
      return [...state.templates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
  },
})
