/// <reference types="node" />
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Tests for public/sw-rest-timer-actions.js — the rest-timer notification
 * action handler that runs inside the generated service worker (LIFT-751).
 *
 * The file is plain JS that registers a `notificationclick` listener on the SW
 * global (`self`). We evaluate it against a fake `self`, capture the registered
 * handler, then drive it with synthetic events to assert it focuses/opens a
 * window and relays the chosen action back to the page.
 */
const handlerSource = readFileSync(
  resolve(__dirname, '../../../public/sw-rest-timer-actions.js'),
  'utf-8',
)

interface FakeClient {
  focus: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

function loadHandler(clients: FakeClient[], openWindow?: ReturnType<typeof vi.fn>) {
  let registered: ((event: unknown) => void) | undefined
  const fakeSelf = {
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      if (type === 'notificationclick') registered = cb
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue(clients),
      openWindow,
    },
  }
  new Function('self', handlerSource)(fakeSelf)
  if (!registered) throw new Error('handler did not register a notificationclick listener')
  return { handler: registered, fakeSelf }
}

function makeEvent(action: string) {
  const close = vi.fn()
  let waited: Promise<unknown> | undefined
  return {
    event: {
      action,
      notification: { close },
      waitUntil: (p: Promise<unknown>) => { waited = p },
    },
    close,
    getWaited: () => waited,
  }
}

describe('sw-rest-timer-actions notificationclick handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the notification and focuses an open window, relaying the action', async () => {
    const client: FakeClient = { focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() }
    const { handler } = loadHandler([client])
    const { event, close, getWaited } = makeEvent('snooze')

    handler(event)
    await getWaited()

    expect(close).toHaveBeenCalledOnce()
    expect(client.focus).toHaveBeenCalledOnce()
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'lift-rest-timer-action', action: 'snooze' })
  })

  it('treats a body tap (empty action) as "open"', async () => {
    const client: FakeClient = { focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() }
    const { handler } = loadHandler([client])
    const { event, getWaited } = makeEvent('')

    handler(event)
    await getWaited()

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'lift-rest-timer-action', action: 'open' })
  })

  it('opens a new window on the Workouts tab when no client is open', async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined)
    const { handler } = loadHandler([], openWindow)
    const { event, getWaited } = makeEvent('open')

    handler(event)
    await getWaited()

    expect(openWindow).toHaveBeenCalledWith('./?tab=workouts')
  })
})
