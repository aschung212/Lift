# Contributing to Lift

Thanks for your interest in contributing to Lift! This guide will help you get set up and start contributing.

## Prerequisites

- **Node.js 20+** and **npm**
- A modern browser (Chrome/Safari recommended for PWA testing)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/aschung212/Lift.git
cd Lift

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The app runs at `http://localhost:5173`.

## Project Structure

```
src/
├── components/     # Vue SFCs (WorkoutTracker, CalendarView, etc.)
├── composables/    # Reusable composition functions (useTheme, useAuth, etc.)
├── stores/         # Pinia stores (workout, bodyweight, preferences, templates)
├── lib/            # Utilities (syncQueue, conflictResolver, uuid, migrate)
├── assets/         # Static assets
├── App.vue         # Root component with tab navigation
└── main.ts         # Entry point
```

## Development Workflow

1. **Create a branch** from `master`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes** following the code standards below.

3. **Run checks** before committing:
   ```bash
   npm run lint        # ESLint — zero errors required
   npm run typecheck   # TypeScript strict mode
   npm test            # Vitest unit tests
   npm run build       # Vite production build
   ```

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add rest timer presets (MAS-XXX)
   fix: correct 1RM calculation for single-rep sets
   test: add CalendarView navigation tests
   ```

5. **Open a PR** against `master`. The CI pipeline runs lint, typecheck, build, and tests automatically.

## Code Standards

- **TypeScript strict mode.** All new files must be `.ts` or `.vue` with `lang="ts"`. Avoid `any`.
- **Tests required.** Every new feature or store change needs Vitest tests. No trivial "it exists" tests — test behavior.
- **ESLint clean.** Zero errors. Address warnings where possible.
- **iOS HIG sensibility.** UI should feel native: 44pt touch targets, progressive disclosure, grouped settings.
- **Local-first.** Never make the UI wait on the network. Pinia + localStorage is the source of truth; Supabase syncs in the background.

## Writing Tests

Tests live next to the code they test in `__tests__/` directories:

```
src/stores/__tests__/workout.test.js
src/components/__tests__/WorkoutTracker.test.js
```

We use **Vitest** with **happy-dom** and **@vue/test-utils**. Mock Supabase in every test file:

```ts
vi.mock('../../lib/supabase', () => ({ supabase: null }))
```

Run tests with:
```bash
npm test              # Single run
npx vitest --watch    # Watch mode
```

## Architecture Decisions

- **Hand-rolled SVGs** for charts — no chart libraries. This keeps the bundle small and the rendering fast.
- **CSS custom properties** for theming (6 themes, light/dark/auto, optional glass morphism).
- **Debounced sync queue** batches rapid Supabase mutations to avoid rate limits.
- **Last-write-wins conflict resolution** for multi-device sync.

## Reporting Issues

Use [GitHub Issues](https://github.com/aschung212/Lift/issues) with the provided templates. Include:
- Steps to reproduce
- Expected vs. actual behavior
- Browser and device info

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
