import { vi } from 'vitest'

// Test stub for the `virtual:pwa-register` module provided by vite-plugin-pwa
// at build time. The plugin's virtual module does not exist in the Vitest
// environment, so vitest.config.js aliases `virtual:pwa-register` here.
// Tests import this same `registerSW` instance to assert registration behavior.
export const registerSW = vi.fn()
