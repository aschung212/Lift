import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { inject } from '@vercel/analytics'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App.vue'
import './index.css'

inject()
injectSpeedInsights()

createApp(App)
    .use(createPinia())
    .mount('#app');
