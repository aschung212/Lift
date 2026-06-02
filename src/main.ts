import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import { initNativePlugins } from './lib/native'
import { initTheme } from './composables/useTheme'
import { setSentryCaptureException, logError } from './lib/logger'
import { isNative } from './lib/platform'
import App from './App.vue'
import './index.css'

// Defer analytics injection to after first paint — analytics should never
// compete with rendering.  Sentry already uses a lazy import().then() pattern;
// Vercel Analytics and Speed Insights follow the same principle here.
const deferAfterPaint = (fn: () => void): void => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn)
  } else {
    setTimeout(fn, 0)
  }
}

deferAfterPaint(() => {
  // Vercel Analytics + Speed Insights are web-only (LIFT-533): keep them out of
  // the iOS Capacitor build so the native app makes no analytics network calls,
  // simplifying any future App Store privacy declarations.
  if (!isNative) {
    inject()
    injectSpeedInsights()
  }
})

initNativePlugins()

// Initialize theme before mounting to prevent FOUC (flash of unstyled content).
// This reads persisted preferences from localStorage and applies them to the DOM.
initTheme()

const app = createApp(App)
app.use(createPinia())

// ── Sentry error monitoring (lazy-loaded to improve TTI) ──────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

if (sentryDsn && import.meta.env.PROD) {
  import('@sentry/vue').then((Sentry) => {
    Sentry.init({
      app,
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      // Distinguish web vs. iOS crashes in Sentry releases (LIFT-533).
      release: `${isNative ? 'ios' : 'web'}@${__APP_VERSION__}`,
      tracesSampleRate: 0.1,
      enabled: true,
      // Never attach default PII (IP, headers, cookies) on web or native (LIFT-533).
      sendDefaultPii: false,
      denyUrls: [
        // Bot probes for CMS/REST endpoints that don't exist in this SPA
        /\/js\/rest\//,
        /\/wp-(admin|content|includes)\//,
        /\/xmlrpc\.php/,
      ],
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies
        // Scrub IP address — defensive even with sendDefaultPii:false (LIFT-533).
        if (event.user) delete event.user.ip_address
        return event
      },
    })
    setSentryCaptureException((err, ctx) => Sentry.captureException(err, { extra: ctx }))
  })
}

app.config.errorHandler = (err, _instance, info) => {
  logError(err, { vueInfo: info })
}

app.mount('#app')
