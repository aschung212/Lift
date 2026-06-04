import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// reloadWhenSafe holds a module-scoped `reloadScheduled` guard, so each test
// re-imports the module fresh to start from a clean slate.
let isSafeToReload: typeof import('../safeReload').isSafeToReload
let reloadWhenSafe: typeof import('../safeReload').reloadWhenSafe

async function freshImport() {
  vi.resetModules()
  const mod = await import('../safeReload')
  isSafeToReload = mod.isSafeToReload
  reloadWhenSafe = mod.reloadWhenSafe
}

/** Wait a macrotask so MutationObserver microtasks have flushed. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('safeReload', () => {
  beforeEach(async () => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
    await freshImport()
  })

  afterEach(() => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
  })

  describe('isSafeToReload', () => {
    it('is true with no modal open and no input focused', () => {
      expect(isSafeToReload()).toBe(true)
    })

    it('is false while a modal is open (modal-open class on <html>)', () => {
      document.documentElement.classList.add('modal-open')
      expect(isSafeToReload()).toBe(false)
    })

    it('is false while an input is focused', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      expect(document.activeElement).toBe(input)
      expect(isSafeToReload()).toBe(false)
    })

    it('is false while a textarea is focused', () => {
      const ta = document.createElement('textarea')
      document.body.appendChild(ta)
      ta.focus()
      expect(isSafeToReload()).toBe(false)
    })
  })

  describe('reloadWhenSafe', () => {
    it('reloads immediately when it is safe', () => {
      const reload = vi.fn()
      reloadWhenSafe(reload)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('does NOT reload while a modal is open, then reloads once it closes', async () => {
      document.documentElement.classList.add('modal-open')
      const reload = vi.fn()

      reloadWhenSafe(reload)
      expect(reload).not.toHaveBeenCalled()

      // User closes the modal — class removed triggers the deferred reload.
      document.documentElement.classList.remove('modal-open')
      await flush()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('does NOT reload while an input is focused, then reloads on focusout', async () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      const reload = vi.fn()

      reloadWhenSafe(reload)
      expect(reload).not.toHaveBeenCalled()

      input.blur()
      input.dispatchEvent(new Event('focusout', { bubbles: true }))
      await flush()
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('schedules only one reload when called repeatedly while unsafe', async () => {
      document.documentElement.classList.add('modal-open')
      const reload = vi.fn()

      reloadWhenSafe(reload)
      reloadWhenSafe(reload)
      reloadWhenSafe(reload)
      expect(reload).not.toHaveBeenCalled()

      document.documentElement.classList.remove('modal-open')
      await flush()
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })
})
