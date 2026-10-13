import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appScreen, type AppScreenState } from '../appScreen'

const state = (overrides: Partial<AppScreenState>): AppScreenState => ({
  loading: false,
  signedIn: true,
  signingIn: false,
  onboarding: false,
  ...overrides,
})

describe('appScreen (LIFT-1546)', () => {
  it('shows nothing but the splash while a cold start resolves', () => {
    expect(appScreen(state({ loading: true }))).toBe('splash')
    expect(appScreen(state({ loading: true, signedIn: false }))).toBe('splash')
  })

  it('shows the auth screen to nobody signed in', () => {
    expect(appScreen(state({ signedIn: false }))).toBe('auth')
    expect(appScreen(state({ signedIn: false, onboarding: true }))).toBe('auth')
  })

  it('keeps the auth screen up while a sign-in waits for its account, onboarding or not', () => {
    // On a device holding none of the user's data, `onboarding` is true until
    // the first read lands whether or not this lifter is new.
    expect(appScreen(state({ signingIn: true, onboarding: true }))).toBe('auth')
    expect(appScreen(state({ signingIn: true }))).toBe('auth')
  })

  it('shows onboarding, then the app, once the account can be shown', () => {
    expect(appScreen(state({ onboarding: true }))).toBe('onboarding')
    expect(appScreen(state({}))).toBe('app')
  })
})

/**
 * App.vue cannot practically be mounted, so its template is read as text:
 * the decision above only matters if App.vue renders from it. These pin each
 * top-level screen to its `appScreen` answer, and the answer to the state that
 * carries the LIFT-1546 fix. Before it, AuthScreen rendered on `!user` alone
 * and OnboardingScreen on `showOnboarding`.
 */
describe('App.vue renders the screen appScreen decides', () => {
  const app = readFileSync(resolve(__dirname, '../../App.vue'), 'utf-8')
  const template = app.slice(0, app.indexOf('<script'))
  const tag = (name: string): string => {
    const match = template.match(new RegExp(`<${name}\\b[^>]*>`))
    expect(match, `<${name}> in App.vue's template`).not.toBeNull()
    return match![0]
  }

  it('gates everything behind the splash, AuthScreen, and OnboardingScreen on it', () => {
    expect(template).toContain(`<template v-if="screen !== 'splash'">`)
    expect(tag('AuthScreen')).toContain(`v-if="screen === 'auth'"`)
    expect(tag('OnboardingScreen')).toContain(`v-else-if="screen === 'onboarding'"`)
  })

  it('feeds it the sign-in hold alongside the user and the onboarding state', () => {
    const call = app.match(/const screen = computed\(\(\) => appScreen\(\{([\s\S]*?)\}\)\)/)
    expect(call, 'the screen computed').not.toBeNull()
    const fields = call![1]
    expect(fields).toMatch(/loading:\s*loading\.value/)
    expect(fields).toMatch(/signedIn:\s*user\.value !== null/)
    expect(fields).toMatch(/signingIn:\s*signingIn\.value/)
    expect(fields).toMatch(/onboarding:\s*showOnboarding\.value/)
  })
})
