import { ref, readonly, type DeepReadonly, type Ref } from 'vue'

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

/** Clear the active toast and its timeout without committing or undoing. */
function destroy() {
  if (!activeToast.value) return
  clearTimeout(activeToast.value.timeoutId)
  activeToast.value = null
}

export interface UseUndoToastReturn {
  toast: DeepReadonly<Ref<UndoToast | null>>
  show: (message: string, undo: () => void, commit: () => void) => void
  performUndo: () => void
  dismiss: () => void
  destroy: () => void
}

export function useUndoToast(): UseUndoToastReturn {
  return {
    toast: readonly(activeToast),
    show,
    performUndo,
    dismiss,
    destroy,
  }
}
