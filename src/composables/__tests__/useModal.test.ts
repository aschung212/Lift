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

  it('focuses the container, not the first field, when focusContainer is set', async () => {
    // Regression (#830 follow-up): auto-focusing a text/number input on open
    // shows the iOS caret but withholds the keyboard, and a later tap on the
    // already-focused field can't summon it. focusContainer keeps focus on the
    // dialog so the user's first tap is a fresh, keyboard-raising focus.
    modalEl = document.createElement('div')
    modalEl.setAttribute('aria-labelledby', 'fc-title')
    modalEl.innerHTML = '<input class="firstField" /><button>Save</button>'
    document.body.appendChild(modalEl)

    const { open, close } = useModal({
      selector: '[aria-labelledby="fc-title"]',
      focusContainer: true,
    })

    open()
    await nextTick()
    await nextTick()

    // The input must NOT be auto-focused; the dialog container takes focus.
    expect(document.activeElement).not.toBe(modalEl.querySelector('.firstField'))
    expect(document.activeElement).toBe(modalEl)

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

// Focus-trap lifecycle (LIFT-894): useModal is the composable that wraps
// useFocusTrap with the watch → nextTick → activate/deactivate lifecycle every
// v-if modal needs. The specs above prove activation happens; these pin the
// *ordering* and *teardown* contracts a screen-reader/keyboard user depends on:
// callbacks must observe the post-activation/post-deactivation focus state, the
// keydown trap must be torn down on close, and the selector target must be
// re-resolved on every open (element-getter freshness), not cached from the
// first open.
describe('useModal — focus-trap lifecycle', () => {
  let modalEl: HTMLElement | null = null

  afterEach(() => {
    modalEl?.remove()
    modalEl = null
    // A leaked lock would silently corrupt the scroll-lock describe below.
    expect(isLocked()).toBe(false)
  })

  it('runs onOpen AFTER the focus trap has activated', async () => {
    modalEl = createModal('order-open')
    let focusedWhenCalled: Element | null = null
    const { open, close } = useModal({
      selector: '[aria-labelledby="order-open"]',
      // If onOpen fired before activate(), focus would still be on <body>.
      onOpen: () => {
        focusedWhenCalled = document.activeElement
      },
    })

    open()
    await nextTick()
    await nextTick()

    expect(focusedWhenCalled).toBe(modalEl.querySelector('button'))

    close()
    await nextTick()
  })

  it('runs onClose AFTER the trap deactivates and focus is restored', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Trigger'
    document.body.appendChild(trigger)
    trigger.focus()

    modalEl = createModal('order-close')
    let focusedWhenCalled: Element | null = null
    const { open, close } = useModal({
      selector: '[aria-labelledby="order-close"]',
      // deactivate() restores focus to the trigger; onClose must see that.
      onClose: () => {
        focusedWhenCalled = document.activeElement
      },
    })

    open()
    await nextTick()
    await nextTick()

    close()
    await nextTick()

    expect(focusedWhenCalled).toBe(trigger)
    trigger.remove()
  })

  it('tears down the keydown trap on close (Tab no longer intercepted)', async () => {
    modalEl = createModal('teardown')
    const { open, close } = useModal({
      selector: '[aria-labelledby="teardown"]',
    })

    open()
    await nextTick()
    await nextTick()

    // While open, a Tab at the last element wraps to the first (trap active).
    const buttons = modalEl.querySelectorAll<HTMLElement>('button')
    const last = buttons[buttons.length - 1]
    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(buttons[0])

    close()
    await nextTick()

    // After close the listener is gone: Tab must NOT be preventDefaulted.
    last.focus()
    const freeTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    const pd = vi.spyOn(freeTab, 'preventDefault')
    document.dispatchEvent(freeTab)
    expect(pd).not.toHaveBeenCalled()
  })

  it('re-resolves the selector on every open (element-getter freshness)', async () => {
    const { open, close } = useModal({
      selector: '[aria-labelledby="fresh"]',
    })

    // First open against one DOM node.
    modalEl = createModal('fresh')
    open()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(modalEl.querySelector('button'))
    close()
    await nextTick()

    // The node is replaced (v-if re-render) — a cached element would trap the
    // stale node; useModal must re-query and trap the NEW one.
    modalEl.remove()
    modalEl = createModal('fresh')
    const freshButton = modalEl.querySelector('button')
    open()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(freshButton)

    close()
    await nextTick()
  })

  it('re-activates the trap when re-opened after a close', async () => {
    modalEl = createModal('reopen')
    const { open, close } = useModal({
      selector: '[aria-labelledby="reopen"]',
    })

    open()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(modalEl.querySelector('button'))

    close()
    await nextTick()

    // Move focus elsewhere so re-activation is observable.
    document.body.focus()

    open()
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(modalEl.querySelector('button'))

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

// Escape-to-close ownership (LIFT-878): useModal owns a single window keydown
// listener attached on open and removed on close/unmount, so PRBurst and
// WorkoutCompleteView no longer hand-roll add/remove listener boilerplate.
describe('useModal — Escape-to-close', () => {
  function pressEscape() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  }
  function pressEnter() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  }

  it('calls onEscape when Escape is pressed while open', async () => {
    const onEscape = vi.fn()
    const { open, close } = useModal({ onEscape })
    open()
    await nextTick()
    pressEscape()
    expect(onEscape).toHaveBeenCalledOnce()
    close()
    await nextTick()
  })

  it('ignores non-Escape keys', async () => {
    const onEscape = vi.fn()
    const { open, close } = useModal({ onEscape })
    open()
    await nextTick()
    pressEnter()
    expect(onEscape).not.toHaveBeenCalled()
    close()
    await nextTick()
  })

  it('does not fire onEscape before open or after close', async () => {
    const onEscape = vi.fn()
    const { open, close } = useModal({ onEscape })

    pressEscape() // before open — no listener attached
    expect(onEscape).not.toHaveBeenCalled()

    open()
    await nextTick()
    close()
    await nextTick()

    pressEscape() // after close — listener detached
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('attaches at most one listener across duplicate open() calls', async () => {
    const onEscape = vi.fn()
    const { open, close } = useModal({ onEscape })
    open()
    open() // duplicate — must not double-attach
    await nextTick()
    pressEscape()
    expect(onEscape).toHaveBeenCalledOnce()
    close()
    await nextTick()
  })

  it('detaches the listener on unmount (no leak)', async () => {
    const onEscape = vi.fn()
    const { open, unmount } = modalWithUnmount({ onEscape })
    open()
    await nextTick()
    unmount?.() // v-if flipped without close()
    pressEscape()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('does not attach any listener when onEscape is omitted', async () => {
    // A plain modal (no onEscape) must not touch window keydown at all.
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { open, close } = useModal()
    open()
    await nextTick()
    const keydownAdds = addSpy.mock.calls.filter(([type]) => type === 'keydown')
    expect(keydownAdds).toHaveLength(0)
    close()
    await nextTick()
    addSpy.mockRestore()
  })
})
