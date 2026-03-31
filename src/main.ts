import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as Sentry from '@sentry/vue'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.vue'
import './index.css'

inject()
injectSpeedInsights()

const app = createApp(App)
app.use(createPinia())

// ── Sentry error monitoring ────────────────────────────────────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (sentryDsn) {
  Sentry.init({
    app,
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    // Only send errors in production
    enabled: import.meta.env.PROD,
    // Scrub sensitive data
    beforeSend(event) {
      if (event.request?.cookies) delete event.request.cookies
      return event
    },
  })
}

app.config.errorHandler = (err, _instance, info) => {
  console.error(`[Vue Error] ${info}:`, err)
  if (sentryDsn && err instanceof Error) {
    Sentry.captureException(err, { extra: { info } })
  }
}

app.mount('#app');
