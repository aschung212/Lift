import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.lift.tracker',
  appName: 'Lift',
  webDir: 'dist',
  server: {
    // In dev, connect to the Vite dev server
    ...(process.env.CAPACITOR_DEV_URL
      ? { url: process.env.CAPACITOR_DEV_URL, cleartext: true }
      : {}),
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'Lift',
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
}

export default config
