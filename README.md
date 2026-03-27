# Lift — Workout Tracker PWA

A **zero-dependency, offline-first Progressive Web App** for tracking strength training. Built entirely with Vue 3, Pinia, and hand-rolled SVG — no UI component libraries, no external chart packages.

**[→ Live Demo](https://your-app.vercel.app)** *(update after deploying)*

![Vue 3](https://img.shields.io/badge/Vue-3.4-42b883?logo=vue.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline--first-5a0fc8)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What It Does

Lift lets you track any strength exercise over time. Log a set (weight + reps + date), and the app immediately computes your estimated 1-rep max, detects whether you just hit a personal record, and plots your progress on a live SVG chart. All data lives in `localStorage` — no backend, no account required.

---

## Features

| Feature | Details |
|---|---|
| **Set logging** | Record weight, reps, and date for any exercise |
| **1RM estimation** | Epley formula (`weight × (1 + reps / 30)`) computed on every set |
| **Progress graphs** | Per-exercise SVG line chart — best estimated 1RM per day, area fill, PR annotations |
| **Personal records** | Automatic PR detection with highlighted dot + badge |
| **Full CRUD** | Add, edit, and delete individual sets or clear all sets for an exercise |
| **5 themes** | Midnight · Graphite · Arctic · Forge · Garden — persisted across sessions |
| **Offline-first PWA** | Installable on iOS and Android; all assets pre-cached via Workbox service worker |
| **Persistent storage** | `localStorage` — data survives app restarts and device reboots |

---

## Tech Stack & Design Decisions

| Layer | Choice | Why |
|---|---|---|
| **UI framework** | Vue 3 (`<script setup>`, Composition API) | Fine-grained reactivity; single-file components keep markup, logic, and styles co-located |
| **State management** | Pinia | Lightweight, type-friendly alternative to Vuex; store syncs to `localStorage` on every mutation |
| **Build tooling** | Vite 5 | Sub-second HMR, native ESM, zero config for Vue |
| **PWA / Service worker** | `vite-plugin-pwa` + Workbox | Pre-caches all static assets at build time; runtime strategy falls back to cache for offline use |
| **Charts** | Hand-rolled SVG | No chart library needed — the graph is a `<polyline>` + `<polygon>` computed from normalized data points in a Vue `computed` property |
| **Styling** | CSS custom properties | All 5 themes are a single `:root` swap; no runtime JS required for theme changes |
| **Deployment** | Vercel / Netlify | Both ship with config files (`vercel.json`, `netlify.toml`) already in the repo |

---

## How the Graph Works

Rather than pulling in a charting library, `ExerciseGraph.vue` builds its own SVG from scratch. A `computed` property:

1. Groups all sets by date and picks the best estimated 1RM per day
2. Normalises each point to `(x, y)` pixel coordinates within fixed padding bounds
3. Flags each point as a PR if its 1RM is the all-time max up to that date
4. Renders a `<polyline>` for the line, a `<polygon>` for the area fill, `<circle>` dots for each data point, and a `<text>` PR label where applicable

This means zero external dependencies and total control over appearance — the chart inherits the active theme automatically through CSS custom properties.

---

## Getting Started

```bash
# Clone and install
git clone https://github.com/aschung212/spa.git
cd spa
npm install

# Generate PWA icons (pure Node.js, no deps required)
node scripts/generate-icons.js

# Start the dev server at http://localhost:5173
npm run dev
```

### Production build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build locally
```

### Deploy

Push to GitHub and connect the repo to [Vercel](https://vercel.com) or [Netlify](https://netlify.com). Both platforms auto-detect `npm run build` and the `dist/` output directory. Config files for both are already included.

---

## Project Structure

```
├── public/
│   ├── icon.svg               # Source SVG app icon
│   ├── icon-192.png           # PWA manifest icon (192×192)
│   ├── icon-512.png           # PWA manifest icon (512×512)
│   └── apple-touch-icon.png   # iOS home screen icon (180×180)
├── scripts/
│   └── generate-icons.js      # Zero-dependency icon generator
├── src/
│   ├── components/
│   │   ├── WorkoutTracker.vue  # Main UI — exercise list, log modal, edit modal
│   │   └── ExerciseGraph.vue   # Hand-rolled SVG progress chart
│   ├── composables/
│   │   └── useTheme.js         # Theme switching + localStorage persistence
│   ├── stores/
│   │   └── workout.js          # Pinia store — CRUD actions + Epley 1RM + getters
│   ├── App.vue
│   ├── main.js
│   └── index.css               # Design tokens (CSS vars) + all styles for all themes
├── index.html
├── vite.config.js
├── netlify.toml
└── vercel.json
```

---

## PWA / Installing on Mobile

- **iOS (Safari):** Share → "Add to Home Screen" → launches in standalone mode (no browser chrome)
- **Android (Chrome):** Browser prompts to install, or use the menu → "Add to Home Screen"
- Once installed, the app works fully offline — all assets are pre-cached on first load by the Workbox service worker
- Data is stored in `localStorage` and persists indefinitely

---

## Regenerating Icons

The icon generator is a zero-dependency Node script that programmatically renders a barbell graphic and outputs all required PWA icon sizes:

```bash
node scripts/generate-icons.js
# → public/icon-192.png
# → public/icon-512.png
# → public/apple-touch-icon.png
```

---

## License

MIT
