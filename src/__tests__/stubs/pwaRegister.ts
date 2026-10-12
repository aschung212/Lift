import { vi } from 'vitest'

// Test stub for the `virtual:pwa-register` module provided by vite-plugin-pwa
// at build time. The plugin's virtual module does not exist in the Vitest
// environment, so vitest.config.js aliases `virtual:pwa-register` here.
// Tests import this same `registerSW` instance to assert registration behavior.
//
// A stub cannot show what the real module does with the options it is given,
// and that is where LIFT-1511 hid: with no `onNeedReload` the plugin reloads
// the page itself. serviceWorkerPluginReload.test.ts runs the installed
// plugin's module instead, for behaviour that belongs to the plugin.
export const registerSW = vi.fn()
