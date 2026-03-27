# Lift — Workout Tracker

A progressive web app (PWA) for tracking strength training. Log sets, visualise progress, and hit personal records.

**[→ Live demo](https://your-app.vercel.app)** *(update this link after deploying)*

---

## Features

- **Set logging** — record weight, reps, and date for any exercise
- **1-rep max estimation** — Epley formula applied to every set
- **Progress graphs** — per-exercise SVG line charts (best set per day)
- **Personal records** — automatic PR detection with 🏆 badge
- **Edit / delete** — full CRUD on every logged set
- **5 themes** — Midnight · Graphite · Arctic · Forge · Garden
- **Offline-first PWA** — installable on iOS and Android, works with no network
- **Persistent storage** — data lives in `localStorage`; survives app restarts

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI framework | Vue 3 (`<script setup>`, Composition API) |
| State management | Pinia |
| Build tooling | Vite 5 |
| PWA / Service worker | `vite-plugin-pwa` + Workbox |
| Graphs | Hand-rolled SVG (no chart library) |
| Styling | CSS custom properties (5 themes) |
| Deployment | Vercel / Netlify |

---

## Getting Started

```bash
# Install dependencies
npm install

# Generate PWA icons (pure Node.js, no extra deps)
node scripts/generate-icons.js

# Start dev server
npm run dev
```

## Deploying

Push to GitHub and connect the repo to [Vercel](https://vercel.com) or [Netlify](https://netlify.com). Both platforms auto-detect the `npm run build` command and `dist/` output directory. Configuration files for both are already included (`vercel.json`, `netlify.toml`).

```bash
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

---

## Project Structure

```
├── public/
│   ├── icon.svg               # SVG app icon
│   ├── icon-192.png           # PWA icon (192×192)
│   ├── icon-512.png           # PWA icon (512×512)
│   └── apple-touch-icon.png   # iOS home screen icon (180×180)
├── scripts/
│   └── generate-icons.js      # icon generator (zero dependencies)
├── src/
│   ├── components/
│   │   ├── WorkoutTracker.vue  # main tracker UI + modals
│   │   └── ExerciseGraph.vue   # SVG progress chart
│   ├── composables/
│   │   └── useTheme.js         # theme switching + persistence
│   ├── stores/
│   │   └── workout.js          # Pinia store → localStorage
│   ├── App.vue
│   ├── main.js
│   └── index.css               # design tokens + all styles
├── index.html
├── vite.config.js
├── netlify.toml
└── vercel.json
```

---

## PWA / iOS Notes

- **Add to Home Screen** on Safari → tap Share → "Add to Home Screen"
- App launches in standalone mode (no browser chrome)
- All assets are pre-cached by the service worker on first load
- Subsequent loads work completely offline
- Data is stored in `localStorage` and persists indefinitely

---

## Regenerating Icons

```bash
node scripts/generate-icons.js
```

This script has zero npm dependencies and produces `public/icon-192.png`, `public/icon-512.png`, and `public/apple-touch-icon.png` from a programmatically rendered barbell graphic.
