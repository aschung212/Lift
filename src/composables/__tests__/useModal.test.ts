import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick, onUnmounted } from 'vue'
import { useModal } from '../useModal'

// Mock onUnmounted since we're not in a Vue component context. Captured so
// the scroll-lock leak-on-unmount safety net can be exercised directly.
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual as object, onUnmounted: vi.fn() }
})

/**
 * Build a useModal whose onUnmounted callback can be fired manually.
 * useModal registers its lock-release onUnmounted LAST (useFocusTrap
 * registers one first), so the most recent call is the one we want.
 */
function modalWithUnmount(opts?: Parameters<typeof useModal>[0]) {
  const modal = useModal(opts)
  const calls = vi.mocked(onUnmounted).mock.calls
  const unmount = calls[calls.length - 1]?.[0] as (() => void) | undefined
  return { ...modal, unmount }
}

const isLocked = () => document.documentElement.classList.contains('modal-open')

function createModal(id: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('aria-labelledby', id)
  el.innerHTML = '<button>OK</button><button>Cancel</button>'
  document.body.appendChild(el)
  return el
}

describe('useModal', () => {
  let modalEl: HTMLElement | null = null

  afterEach(() => {
    modalEl?.remove()
    modalEl = null
  })

  it('starts closed', () => {
    const { isOpen } = useModal()
    expect(isOpen.value).toBe(false)
  })

  it('opens and closes via open()/close()', () => {
    const { isOpen, open, close } = useModal()
    open()
    expect(isOpen.value).toBe(true)
    close()
    expect(isOpen.value).toBe(false)
  })

  it('activates focus trap on open via selector', async () => {
    modalEl = createModal('test-title')
    const { open, close } = useModal({
      selector: '[aria-labelledby="test-title"]',
    })

    open()
    await nextTick()
    // Wait for the internal watch → nextTick
    await nextTick()

    // Focus trap should have moved focus into the modal
    expect(document.activeElement).toBe(modalEl.querySelector('button'))

    close()
    await nextTick()
  })

  it('activates focus trap on open via trapRef', async () => {
    modalEl = document.createElement('div')
    modalEl.innerHTML = '<input id="first" /><button>OK</button>'
    document.body.appendChild(modalEl)

    const { open, close, trapRef } = useModal()
    trapRef.value = modalEl

    open()
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(modalEl.querySelector('#first'))

    close()
    await nextTick()
  })

  it('calls onOpen callback after activation', async () => {
    modalEl = createModal('cb-test')
    const onOpen = vi.fn()
    const { open, close } = useModal({
      selector: '[aria-labelledby="cb-test"]',
      onOpen,
    })

    open()
    await nextTick()
    await nextTick()

    expect(onOpen).toHaveBeenCalledOnce()

    close()
    await nextTick()
  })

  it('calls onClose callback on close', async () => {
    modalEl = createModal('close-test')
    const onClose = vi.fn()
    const { open, close } = useModal({
      selector: '[aria-labelledby="close-test"]',
      onClose,
    })

    open()
    await nextTick()
    await nextTick()

    close()
    await nextTick()

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to previously focused element on close', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    modalEl = createModal('restore-test')
    const { open, close } = useModal({
      selector: '[aria-labelledby="restore-test"]',
    })

    open()
    await nextTick()
    await nextTick()
    expect(document.activeElement).not.toBe(trigger)

    close()
    await nextTick()
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })

  it('does not activate trap when no element matches selector', async () => {
    const onOpen = vi.fn()
    const { open, close } = useModal({
      selector: '[aria-labelledby="nonexistent"]',
      onOpen,
    })

    open()
    await nextTick()
    await nextTick()

    // onOpen still called — component may need to do other setup
    expect(onOpen).toHaveBeenCalledOnce()

    close()
    await nextTick()
  })
})

// Regression: the Log Weight modal (and CalendarView's modals) used useModal
// but never locked background scroll, unlike every other modal. On iOS that
// leaves `.tabContent` scrollable, so opening the keyboard shifts the visual
// viewport and the fixed overlay's tap targets desync from its paint (caret
// over Save, tapping the weight field opened the date picker). The lock now
// lives in useModal so every consumer gets it. See index.css `html.modal-open`.
describe('useModal — background scroll lock', () => {
  afterEach(() => {
    // Guard against a leaked count silently corrupting the next test.
    expect(isLocked()).toBe(false)
  })

  it('locks background scroll while open, unlocks on close', () => {
    const { open, close } = useModal()
    expect(isLocked()).toBe(false)
    open()
    expect(isLocked()).toBe(true)
    close()
    expect(isLocked()).toBe(false)
  })

  it('stays locked until the LAST stacked modal closes (ref-counted)', () => {
    const a = useModal()
    const b = useModal()
    a.open()
    b.open()
    expect(isLocked()).toBe(true)
    a.close() // inner closes — outer still up
    expect(isLocked()).toBe(true)
    b.close()
    expect(isLocked()).toBe(false)
  })

  it('does not lock when lockScroll is false', () => {
    const { open, close } = useModal({ lockScroll: false })
    open()
    expect(isLocked()).toBe(false)
    close()
    expect(isLocked()).toBe(false)
  })

  it('a lockScroll:false sheet does not drop another modal’s lock when it closes', () => {
    const owner = useModal()              // e.g. WorkoutCompleteView
    const sheet = useModal({ lockScroll: false }) // nested SharePickerSheet
    owner.open()
    sheet.open()
    expect(isLocked()).toBe(true)
    sheet.close()
    expect(isLocked()).toBe(true) // owner still up
    owner.close()
    expect(isLocked()).toBe(false)
  })

  it('is robust to duplicate open()/close() calls (no count drift)', () => {
    const a = useModal()
    const b = useModal()
    a.open()
    a.open()   // duplicate — e.g. click.self + escape both firing
    b.open()
    a.close()
    a.close()  // duplicate close must not over-decrement
    expect(isLocked()).toBe(true) // b still holds the lock
    b.close()
    expect(isLocked()).toBe(false)
  })

  it('releases the lock on unmount if a parent stops rendering it', () => {
    const { open, unmount } = modalWithUnmount()
    open()
    expect(isLocked()).toBe(true)
    unmount?.() // v-if flipped without close()
    expect(isLocked()).toBe(false)
  })
})
