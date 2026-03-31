import { ref, readonly } from 'vue'

export interface UndoToast {
  id: number
  message: string
  undo: () => void
  commit: () => void
  timeoutId: ReturnType<typeof setTimeout>
}

const UNDO_DURATION = 5000

const activeToast = ref<UndoToast | null>(null)
let nextId = 0

function show(message: string, undo: () => void, commit: () => void) {
  // Dismiss any existing toast (commit its action)
  dismiss()

  const id = ++nextId
  const timeoutId = setTimeout(() => {
    if (activeToast.value?.id === id) {
      commit()
      activeToast.value = null
    }
  }, UNDO_DURATION)

  activeToast.value = { id, message, undo, commit, timeoutId }
}

function performUndo() {
  if (!activeToast.value) return
  clearTimeout(activeToast.value.timeoutId)
  activeToast.value.undo()
  activeToast.value = null
}

function dismiss() {
  if (!activeToast.value) return
  clearTimeout(activeToast.value.timeoutId)
  activeToast.value.commit()
  activeToast.value = null
}

export function useUndoToast() {
  return {
    toast: readonly(activeToast),
    show,
    performUndo,
    dismiss,
  }
}
