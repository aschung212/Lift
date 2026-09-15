import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aschung212.lift',
  appName: 'Lift',
  webDir: 'dist',
  server: {
    // In dev, connect to the Vite dev server
    ...(process.env.CAPACITOR_DEV_URL
      ? { url: process.env.CAPACITOR_DEV_URL, cleartext: true }
      : {}),
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
