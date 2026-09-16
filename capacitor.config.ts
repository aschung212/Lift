import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native live reload: `CAPACITOR_DEV_URL=http://192.168.1.x:5173 npx cap run ios`
 * points the WebView at the Vite dev server instead of the assets bundled in
 * the app.
 *
 * It is deliberately IGNORED for a release build (LIFT-1435). `cap sync`
 * resolves this file and writes the answer verbatim into
 * `ios/App/App/capacitor.config.json`, which Capacitor's own `ios/.gitignore`
 * keeps out of git (so it is never diffed or reviewed) and the Xcode project
 * copies into the `.ipa` as a resource. With `server.url` set, WKWebView loads
 * the whole app from that URL and the bundled `public/` assets are dead weight —
 * so an archive cut from the same shell that live-reloads would ship an App
 * Store build whose entire UI comes over plaintext HTTP from a LAN address no
 * user's phone can reach. There was no release discriminator: merely having the
 * variable present in the environment was enough.
 *
 * `CAPACITOR_BUILD=true` is that discriminator, already set by
 * `npm run cap:build` — the command CLAUDE.md mandates for every native build —
 * and already used the same way by `vite.config.js` to disable the service
 * worker (#532). It must be exported for the `cap sync` half of that script too,
 * not just the `vite build` half, or this branch never runs where it matters.
 * `npm run guard:native-config` re-checks the file `cap sync` actually emitted,
 * because a config is only trustworthy once resolved.
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
