import { describe, it, expect, vi, afterEach } from 'vitest'
import { useFocusTrap } from '../useFocusTrap'

// Mock onUnmounted since we're not in a Vue component context
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return { ...actual as object, onUnmounted: vi.fn() }
})

function createModal(innerHTML: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = innerHTML
  document.body.appendChild(el)
  return el
}

describe('useFocusTrap', () => {
  let modal: HTMLElement
  let deactivateFn: (() => void) | null = null

  afterEach(() => {
    deactivateFn?.()
    deactivateFn = null
    modal?.remove()
  })

  it('focuses the first focusable element on activate', () => {
    modal = createModal('<button id="btn1">First</button><button id="btn2">Second</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate

    activate(modal)

    expect(document.activeElement).toBe(modal.querySelector('#btn1'))
  })

  it('focuses the container when no focusable elements exist', () => {
    modal = createModal('<p>No buttons here</p>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate

    activate(modal)

    expect(document.activeElement).toBe(modal)
    expect(modal.getAttribute('tabindex')).toBe('-1')
  })

  it('restores focus to previously focused element on deactivate', () => {
    const trigger = document.createElement('button')
    trigger.id = 'trigger'
    document.body.appendChild(trigger)
    trigger.focus()

    modal = createModal('<button id="inner">Inner</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate

    activate(modal)
    expect(document.activeElement).toBe(modal.querySelector('#inner'))

    deactivate()
    deactivateFn = null
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })

  it('traps Tab at the last element — wraps to first', () => {
    modal = createModal('<button id="a">A</button><button id="b">B</button><button id="c">C</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate
    activate(modal)

    const btnC = modal.querySelector<HTMLElement>('#c')!
    btnC.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    const pd = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(pd).toHaveBeenCalled()
    expect(document.activeElement).toBe(modal.querySelector('#a'))
  })

  it('traps Shift+Tab at the first element — wraps to last', () => {
    modal = createModal('<button id="a">A</button><button id="b">B</button><button id="c">C</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate
    activate(modal)

    expect(document.activeElement).toBe(modal.querySelector('#a'))

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    const pd = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(pd).toHaveBeenCalled()
    expect(document.activeElement).toBe(modal.querySelector('#c'))
  })

  it('skips disabled buttons in the focusable list', () => {
    modal = createModal('<button id="a">A</button><button id="b" disabled>B</button><button id="c">C</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate
    activate(modal)

    const btnC = modal.querySelector<HTMLElement>('#c')!
    btnC.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    document.dispatchEvent(event)

    expect(document.activeElement).toBe(modal.querySelector('#a'))
  })

  it('does not interfere with non-Tab keys', () => {
    modal = createModal('<button id="a">A</button>')
    const { activate, deactivate } = useFocusTrap()
    deactivateFn = deactivate
    activate(modal)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const pd = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(pd).not.toHaveBeenCalled()
  })

  it('cleans up event listener on deactivate', () => {
    modal = createModal('<input id="x" /><input id="y" />')
    const { activate, deactivate } = useFocusTrap()
    activate(modal)

    // Verify trap is active
    const inputY = modal.querySelector<HTMLElement>('#y')!
    inputY.focus()
    const trappedEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    document.dispatchEvent(trappedEvent)
    expect(document.activeElement).toBe(modal.querySelector('#x'))

    // Deactivate and verify Tab is no longer intercepted by this instance
    deactivate()
    deactivateFn = null

    inputY.focus()
    const freeEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    const pd = vi.spyOn(freeEvent, 'preventDefault')
    document.dispatchEvent(freeEvent)

    expect(pd).not.toHaveBeenCalled()
  })
})
