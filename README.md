# Lift — Workout Tracker PWA

A **mobile-first Progressive Web App** for tracking strength training, bodyweight, and personal records. Built with Vue 3, Pinia, Supabase, and hand-rolled SVG — no UI component libraries, no external chart packages.

**[→ Live App](https://spa-rho-sandy.vercel.app)**

![Vue 3](https://img.shields.io/badge/Vue-3.4-42b883?logo=vue.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-cloud--sync-3ecf8e?logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What It Does

Lift lets you track any strength exercise over time. Log a set (weight + reps + date), and the app immediately computes your estimated 1-rep max, detects whether you just hit a personal record, and plots your progress on a live SVG chart. Sign in with Google to sync your data across devices via Supabase — or use the app offline with local storage.

---

## Features

### Workout Tracking
- Log weight, reps, and date for any exercise
- Epley 1RM estimation (`weight × (1 + reps / 30)`) computed on every set
- Per-exercise SVG line chart — best estimated 1RM per day with area fill
- PR detection — gold row highlight + 🏆 trophy badge on personal record sets
- Set list capped at 10 most recent, with "Show all" toggle
- Full CRUD: add, edit, and delete individual sets; clear all sets per exercise
- Drag-to-reorder exercises by grip handle
- Expanded exercise panel with darker inset background for visual contrast

### Exercise Tags
- Tag exercises with custom labels (e.g. Chest, Legs, Push)
- Add tags when creating a new exercise or editing an existing one
- Tappable tag picker with toggle chips for existing tags + text input for new ones
- Pending tag text is auto-saved when hitting Save (no need to tap "+" first)
- Multi-tag filtering on both Workouts and Calendar tabs (ANY match)
- "Clear" button appears above tag chips when a filter is active

### Training Calendar
- Monthly and weekly views of all training days
- Color-coded exercise dots per day (stable color per exercise)
- 🏆 trophy badge on days/exercises where a PR was set
- Tap any day to expand its detail panel (including empty days)
- Tap any exercise tag to expand all sets logged that day
- Set count badge on each exercise tag (e.g. "Bench Press 3")
- PR sets highlighted in gold within the expanded detail
- Log sets directly from the calendar — "+ Log" button on day detail (month) and each day row (week)
- Tag filtering — filter calendar to show only days/exercises matching selected tags

### Body Weight Tracking
- Log daily weigh-ins with date
- SVG line chart filtered by period: 7d / 30d / 90d / 1y
- Stats row per period: Change, Low, High, Avg
- All-time low (green) and high (red) highlighted in the entry list

### Auth & Sync
- Google OAuth via Supabase — one-tap sign in
- Optimistic local-first writes: UI updates instantly, Supabase syncs in background
- One-time migration of existing localStorage data on first sign-in
- Data persists in localStorage for offline use; Supabase for cross-device sync

### UI & Experience
- Bottom tab bar: Workouts · Calendar · Weight — each tab can be shown/hidden in settings (at least one must remain)
- 6 themes: Midnight · Graphite · Arctic · Forge · Aaron · Tina
- Liquid Glass mode — frosted glass cards, tab bar, and modals with per-theme ambient mesh gradients; toggleable and persisted
- Collapsible theme picker with Liquid Glass toggle
- Tap outside theme dropdown to dismiss
- Portrait-only: landscape blocked with a clean overlay
- Scroll locked to each tab's content — no full-page scroll for an app-like feel
- Safe-area insets respected for notched devices

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **UI framework** | Vue 3 (`<script setup>`) | Fine-grained reactivity; single-file components |
| **State** | Pinia | Lightweight store; syncs to localStorage on every mutation |
| **Backend / Auth** | Supabase | Postgres with RLS, Google OAuth, realtime-ready |
| **Build** | Vite 5 | Sub-second HMR, native ESM |
| **PWA** | `vite-plugin-pwa` + Workbox | Pre-caches all static assets; installable on iOS & Android |
| **Charts** | Hand-rolled SVG | `<polyline>` + `<polygon>` computed from normalized data — no chart library |
| **Styling** | CSS custom properties | All themes + glass tokens are a single `data-theme` attribute swap |
| **Deployment** | Vercel | Auto-deploys on push; environment variables set in dashboard |

---

## Architecture Notes

### Local-first writes
Every action updates Pinia state and `localStorage` immediately, then fires a Supabase call in the background. The UI never waits on the network.

### PR detection
`getExercisePR(exerciseId)` returns the all-time max `estimated1RM` across all sets for that exercise. Any set where `set.estimated1RM === PR` gets the gold treatment — in both the workout list and the calendar.

### Calendar PR map
A `prMap` computed property (`YYYY-MM-DD → Set<exerciseName>`) is derived from the store at render time. The calendar reads this to show 🏆 badges on cells and exercise tags without any extra queries.

### Glass system
Each theme defines `--glass-fill`, `--glass-edge`, `--glass-shine`, `--glass-bar`, `--glass-overlay`, and `--mesh` tokens. When `data-glass="on"` (default), cards and chrome use `backdrop-filter: blur()` with translucent fills. `data-glass="off"` overrides fall back to solid `--bg-secondary` / `--bg-elevated` values.

---

## Getting Started

```bash
git clone https://github.com/your-username/lift.git
cd lift
npm install
```

Create `.env.local` with your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run the Supabase migration in `supabase/migration.sql` to create the required tables and RLS policies, then:

```bash
npm run dev   # http://localhost:5173
```

### Production build

```bash
npm run build    # outputs to dist/
npm run preview  # preview production build locally
```

### Deploy

Push to GitHub, connect to [Vercel](https://vercel.com), and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel dashboard. Enable Google as an OAuth provider in Supabase and add your Vercel domain to the allowed redirect URLs.

---

## Project Structure

```
├── public/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── scripts/
│   └── generate-icons.js
├── src/
│   ├── components/
│   │   ├── WorkoutTracker.vue   # Exercise list, log/edit modal, set list, PR badges, tag filtering
│   │   ├── ExerciseGraph.vue    # Per-exercise SVG line chart
│   │   ├── CalendarView.vue     # Monthly/weekly calendar, PR map, set detail, log modal, tag filtering
│   │   ├── BodyweightTracker.vue # Weight log, period stats, SVG chart, low/high badges
│   │   └── AuthScreen.vue       # Google sign-in screen
│   ├── composables/
│   │   ├── useTheme.js          # Theme + glass toggle, localStorage persistence
│   │   ├── useAuth.js           # Supabase session, Google OAuth, store init on sign-in
│   │   └── useAnalytics.js      # Lightweight event logging
│   ├── stores/
│   │   ├── workout.js           # Exercises + sets CRUD, Epley 1RM, PR getter, tags, Supabase sync
│   │   ├── bodyweight.js        # Weight entries CRUD, min/max getters, Supabase sync
│   │   └── preferences.js       # Feature toggles (tab visibility), Supabase sync
│   ├── lib/
│   │   ├── supabase.js          # Supabase client singleton
│   │   ├── migrate.js           # One-time localStorage → Supabase migration
│   │   └── tagColors.js         # Deterministic color assignment for exercise tags
│   ├── App.vue                  # Tab bar, theme picker, glass toggle, settings, auth gate
│   ├── main.js
│   └── index.css                # All theme tokens, glass tokens, component styles
├── supabase/
│   └── migration.sql            # Creates exercises, sets, bodyweight_entries with RLS
├── index.html
├── vite.config.js
└── vercel.json
```

---

## Installing on Mobile

- **iOS (Safari):** Share → "Add to Home Screen" → launches in standalone mode with portrait lock
- **Android (Chrome):** Menu → "Add to Home Screen" or install prompt
- Once installed, all assets are pre-cached by the Workbox service worker for offline use
- The PWA manifest enforces portrait orientation when installed

---

## License

MIT
