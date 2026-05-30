import { describe, it, expect, afterEach } from 'vitest'
import { useFocusTrap, type UseFocusTrapReturn } from '../useFocusTrap'
import { mountComposable } from './browserMount'

/**
 * Browser-mode tests for useFocusTrap.
 *
 * The happy-dom suite (useFocusTrap.test.ts) mocks Vue's onUnmounted and runs
 * against a DOM whose focus model is approximate. Here we run in real Chromium,
 * where `.focus()` truly moves `document.activeElement`, `:focus` is real, and
 * tab order reflects genuine document order — so we validate the trap's actual
 * keyboard-navigation behavior, not just that handlers were wired up.
 */

function createModal(innerHTML: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = innerHTML
  document.body.appendChild(el)
  return el
}

describe('useFocusTrap (browser)', () => {
  let modal: HTMLElement | null = null
  let mounted: { exposed: UseFocusTrapReturn; unmount: () => void } | null = null

  afterEach(() => {
    mounted?.exposed.deactivate()
    mounted?.unmount()
    mounted = null
    modal?.remove()
    modal = null
  })

  function mountTrap() {
    mounted = mountComposable<UseFocusTrapReturn>(() => useFocusTrap())
    return mounted.exposed
  }

  it('moves real focus to the first focusable element on activate', () => {
    modal = createModal('<button id="a">A</button><button id="b">B</button>')
    const trap = mountTrap()

    trap.activate(modal)

    // Real browser focus — document.activeElement actually changes.
    expect(document.activeElement).toBe(modal.querySelector('#a'))
  })

  it('wraps focus from the last element to the first on Tab', () => {
    modal = createModal('<button id="a">A</button><button id="b">B</button><button id="c">C</button>')
    const trap = mountTrap()
    trap.activate(modal)

    const last = modal.querySelector<HTMLElement>('#c')!
    last.focus()
    expect(document.activeElement).toBe(last) // real focus landed on C

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

    expect(document.activeElement).toBe(modal.querySelector('#a'))
  })

  it('wraps focus from the first element to the last on Shift+Tab', () => {
    modal = createModal('<button id="a">A</button><button id="b">B</button><button id="c">C</button>')
    const trap = mountTrap()
    trap.activate(modal)

    expect(document.activeElement).toBe(modal.querySelector('#a'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))

    expect(document.activeElement).toBe(modal.querySelector('#c'))
  })

  it('restores real focus to the trigger element on deactivate', () => {
    const trigger = document.createElement('button')
    trigger.id = 'trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    modal = createModal('<button id="inner">Inner</button>')
    const trap = mountTrap()

    trap.activate(modal)
    expect(document.activeElement).toBe(modal.querySelector('#inner'))

    trap.deactivate()
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })

  it('skips disabled controls and focuses the next enabled one', () => {
    modal = createModal('<button id="a">A</button><button id="b" disabled>B</button><button id="c">C</button>')
    const trap = mountTrap()
    trap.activate(modal)

    const last = modal.querySelector<HTMLElement>('#c')!
    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

    // Wraps to #a, never landing on the disabled #b.
    expect(document.activeElement).toBe(modal.querySelector('#a'))
  })
})
