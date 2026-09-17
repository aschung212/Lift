import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native live reload: `CAPACITOR_DEV_URL=http://192.168.1.x:5173` points the
 * WebView at the Vite dev server instead of the assets bundled in the app. Every
 * Capacitor CLI command that resolves this config reads it — use `npx cap sync`,
 * since `cap run ios` currently cannot build (#1442: `ios.scheme` names an Xcode
 * scheme that does not exist).
 *
 * It is deliberately IGNORED for a release build (LIFT-1435). `cap sync` resolves
 * this file and writes the answer verbatim into
 * `ios/App/App/capacitor.config.json`, which Capacitor's own `ios/.gitignore`
 * keeps out of git — never diffed, never reviewed — and the Xcode project copies
 * into the `.ipa` as a resource. That file, not the TypeScript it came from, is
 * what an archive ships, and with `server.url` set WKWebView loads the entire UI
 * from it while the bundled `public/` assets go unused. There was no release
 * discriminator here: merely having the variable present in the shell was enough,
 * so an archive cut from the shell that live-reloads shipped an App Store build
 * fetching all its JS over plaintext HTTP from a LAN address.
 *
 * `CAPACITOR_BUILD=true` is that discriminator — already set by
 * `npm run cap:build` (the command CLAUDE.md mandates for every native build) and
 * already read the same way by `vite.config.js` to disable the service worker
 * (#532). A `VAR=value cmd` prefix binds to ONE command, so it has to be set on
 * the `cap sync` half of that script as well as the `vite build` half, or this
 * branch never runs where it matters. `npm run guard:native-config` then re-reads
 * the file `cap sync` actually emitted, because a config is only trustworthy once
 * resolved.
 */
const isReleaseBuild = process.env.CAPACITOR_BUILD === 'true'
const devServerUrl = isReleaseBuild ? undefined : process.env.CAPACITOR_DEV_URL

const config: CapacitorConfig = {
  appId: 'com.aschung212.lift',
  appName: 'Lift',
  webDir: 'dist',
  server: {
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  ios: {
    // The page owns the safe areas (viewport-fit=cover + env(safe-area-inset-*)
    // everywhere), so the WebView must not also inset its scroll view for
    // them. 'automatic' shrank the layout viewport by the top+bottom insets
    // (~93pt on an iPhone 17 Pro): the page laid out short and the WebView's
    // own background showed as a white band under the tab bar (#1423).
    // 'never' is Capacitor's default.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scheme: 'Lift',
  },
  plugins: {
    Keyboard: {
      // 'body' rewrote document.body.style.height around every keyboard and
      // left the page scrolled and shifted after dismissal (#1423). 'native'
      // (Capacitor's default) resizes the WebView itself, so 100svh layouts —
      // the app shell, the sheets' sticky action bars — simply follow the
      // keyboard, the way a native screen does.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
}

export default config
