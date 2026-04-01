import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.vue'
import './index.css'

inject()
injectSpeedInsights()

const app = createApp(App)
app.use(createPinia())

// ── Sentry error monitoring (lazy-loaded to improve TTI) ──────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

// Lazy reference populated after dynamic import
let captureException: ((err: Error, ctx?: Record<string, unknown>) => void) | null = null

if (sentryDsn && import.meta.env.PROD) {
  // Dynamic import — Sentry chunk is only fetched in production with a DSN configured
  import('@sentry/vue').then((Sentry) => {
    Sentry.init({
      app,
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      enabled: true,
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies
        return event
      },
    })
    captureException = (err, ctx) => Sentry.captureException(err, { extra: ctx })
  })
}

app.config.errorHandler = (err, _instance, info) => {
  console.error(`[Vue Error] ${info}:`, err)
  if (err instanceof Error) {
    captureException?.(err, { info })
  }
}

app.mount('#app');
