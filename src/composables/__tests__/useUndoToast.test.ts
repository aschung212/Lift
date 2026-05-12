import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useUndoToast } from '../useUndoToast'

describe('useUndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Ensure clean state — dismiss any lingering toast
    const { dismiss } = useUndoToast()
    dismiss()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with no active toast', () => {
    const { toast } = useUndoToast()
    expect(toast.value).toBeNull()
  })

  it('shows a toast with the given message', () => {
    const { toast, show } = useUndoToast()
    show('Set deleted', () => {}, () => {})
    expect(toast.value).not.toBeNull()
    expect(toast.value!.message).toBe('Set deleted')
  })

  it('calls commit after timeout expires', () => {
    const commit = vi.fn()
    const { toast, show } = useUndoToast()
    show('Set deleted', () => {}, commit)
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(commit).toHaveBeenCalledOnce()
    expect(toast.value).toBeNull()
  })

  it('calls undo and clears toast when performUndo is called', () => {
    const undo = vi.fn()
    const commit = vi.fn()
    const { toast, show, performUndo } = useUndoToast()
    show('Set deleted', undo, commit)

    performUndo()
    expect(undo).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(toast.value).toBeNull()

    // Ensure timeout doesn't fire commit after undo
    vi.advanceTimersByTime(5000)
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits previous toast when a new one is shown', () => {
    const commit1 = vi.fn()
    const commit2 = vi.fn()
    const { show } = useUndoToast()

    show('First', () => {}, commit1)
    show('Second', () => {}, commit2)

    expect(commit1).toHaveBeenCalledOnce()
    expect(commit2).not.toHaveBeenCalled()
  })

  it('dismiss commits the active toast', () => {
    const commit = vi.fn()
    const { toast, show, dismiss } = useUndoToast()
    show('Set deleted', () => {}, commit)

    dismiss()
    expect(commit).toHaveBeenCalledOnce()
    expect(toast.value).toBeNull()
  })

  it('dismiss is safe to call with no active toast', () => {
    const { dismiss } = useUndoToast()
    expect(() => dismiss()).not.toThrow()
  })

  it('performUndo is safe to call with no active toast', () => {
    const { performUndo } = useUndoToast()
    expect(() => performUndo()).not.toThrow()
  })

  describe('destroy', () => {
    it('clears the active toast and its timeout without committing or undoing', () => {
      const undo = vi.fn()
      const commit = vi.fn()
      const { toast, show, destroy } = useUndoToast()
      show('Set deleted', undo, commit)

      destroy()
      expect(toast.value).toBeNull()

      // Neither undo nor commit should fire
      vi.advanceTimersByTime(5000)
      expect(undo).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
    })

    it('is safe to call with no active toast', () => {
      const { destroy } = useUndoToast()
      expect(() => destroy()).not.toThrow()
    })
  })
})
