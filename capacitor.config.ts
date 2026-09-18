import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native live reload: `CAPACITOR_DEV_URL=http://192.168.1.x:5173` points the
 * WebView at the Vite dev server instead of the assets bundled in the app. Every
 * Capacitor CLI command that resolves this config reads it, so
 * `CAPACITOR_DEV_URL=… npx cap sync` is the route into the Xcode flow.
 * `npx cap run ios --live-reload` is Capacitor's own route and builds again now
 * that `ios.scheme` no longer names a scheme that does not exist (#1442). It
 * needs no variable — it writes `server.url` straight into the EMITTED config
 * and reverts that on Ctrl-C — but it writes `url` ALONE, where the branch below
 * pairs it with `cleartext: true` to waive ATS for a plain-HTTP dev server.
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
    // `ios.scheme` is deliberately ABSENT, and its absence is the fix for #1442.
    // It is not a URL scheme: in `CapacitorConfig` it is the Xcode BUILD scheme
    // handed to `xcodebuild -scheme` (`@capacitor/cli`'s own declarations:
    // "iOS build scheme to use. Usually this matches your app's target in
    // Xcode", default `App`). It read 'Lift', the committed project's only
    // target — and therefore its only scheme — is `App`, so `npx cap run ios`
    // ran `xcodebuild -scheme Lift` and could not build, including
    // `--live-reload`, which is Capacitor's own sanctioned live-reload path.
    // `cap open ios` + Product → Archive never reads the key, which is why the
    // documented App Store flow worked throughout and this went unnoticed.
    // Absence — not a corrected `scheme: 'App'` — resolves to the same scheme
    // and says there is no decision here to get wrong; a restated default is
    // what let the wrong value read as a deliberate setting.
    //
    // The WebView's ORIGIN is a different option: `server.iosScheme` (default
    // `capacitor`), which Lift does not set — so the bundled app is served from
    // `capacitor://localhost`, the origin #1425's dev-surface gate, #1430's
    // password-reset flow and api/coach.ts's CORS allow-list all reason about.
    // Wanting a custom URL scheme is a separate decision that also needs the
    // matching `CFBundleURLTypes` work; it is not a rename of this key.
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
