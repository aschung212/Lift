import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import { initNativePlugins } from './lib/native'
import { initTheme } from './composables/useTheme'
import { setSentryCaptureException, logError } from './lib/logger'
import App from './App.vue'
import './index.css'

inject()
injectSpeedInsights()
initNativePlugins()
// Apply persisted theme/mode to DOM before first paint to prevent FOUC.
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
      tracesSampleRate: 0.1,
      enabled: true,
      denyUrls: [
        // Bot probes for CMS/REST endpoints that don't exist in this SPA
        /\/js\/rest\//,
        /\/wp-(admin|content|includes)\//,
        /\/xmlrpc\.php/,
      ],
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies
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
