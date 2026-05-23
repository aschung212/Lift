import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useModal } from '../useModal'

// Mock onUnmounted since we're not in a Vue component context
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual as object, onUnmounted: vi.fn() }
})

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
