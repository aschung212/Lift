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

/** Wait a macrotask so the MutationObserver microtask has flushed. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Force document.visibilityState and fire the matching visibilitychange. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('safeReload', () => {
  beforeEach(async () => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
    setVisibility('visible')
    await freshImport()
  })

  afterEach(() => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
    setVisibility('visible')
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

    it('defers while an input is focused and does not reload on its blur', async () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      const reload = vi.fn()

      reloadWhenSafe(reload)
      expect(reload).not.toHaveBeenCalled()

      // Blurring/focusout must NOT trigger a reload — it fires synchronously
      // during the mousedown that moves focus (e.g. tapping Save) and would
      // unload the page before the click handler runs, losing the action.
      input.blur()
      input.dispatchEvent(new Event('focusout', { bubbles: true }))
      await flush()
      expect(reload).not.toHaveBeenCalled()
    })

    it('reloads when the page becomes hidden (backgrounded / navigated away)', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      const reload = vi.fn()

      reloadWhenSafe(reload)
      expect(reload).not.toHaveBeenCalled()

      // User backgrounds the app — the safest possible moment to reload.
      setVisibility('hidden')
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
