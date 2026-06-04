# Lift — Claude Guidelines

## About This Project
Lift is Aaron Chung's primary portfolio project — a mobile-first PWA workout tracker. Aaron is an ex-AWS SDE2 targeting SWE roles at companies like Notion, Airtable, and Linear. This app needs to demonstrate engineering rigor and product taste.

**Live:** spa-rho-sandy.vercel.app (THIS IS THE ONLY VALID DEPLOYMENT DOMAIN)
**Issues:** github.com/aschung212/Lift/issues (migrated from Linear on 2026-04-03)
**Deploy:** Vercel auto-deploys from master. Never push directly to master.

> **SEV1 RULE — Never fabricate external identifiers.** On 2026-04-02, the overnight builder hallucinated `liftracker.app` (a competitor's domain) as our canonical URL and it shipped to production. NEVER invent, guess, or fabricate URLs, domains, API keys, or external identifiers. The deployment domain is `spa-rho-sandy.vercel.app` — if you need it, read it from this file. If you cannot find an authoritative value for something, SKIP the task.

## Design Principles

Follow these in every UI decision:

1. **iOS HIG is the north star.** Every component should feel like it belongs in a native iOS app. Use Apple's Human Interface Guidelines as a checklist: 44pt touch targets, SF-style typography scale, progressive disclosure, grouped settings.

2. **No feature bloat.** Before adding a feature, ask: does this duplicate something that already exists? If tags already solve the problem, don't add templates. Every feature must earn its place. When in doubt, don't add it.

3. **Progressive disclosure.** Show the minimum needed at each level. Details expand on tap. Settings are grouped. Modals drill down, not sideways. The user should never see 10 options when 3 will do.

4. **Visual over verbal.** Surface information at the right moment through visual cues — tappable banners, color changes, badges, toasts — not through text-heavy explanations or separate screens.

5. **One interaction path, not three.** Enhance existing patterns rather than adding parallel ones. If there's already a way to do something, make that way better instead of creating an alternative.

6. **Consistent modal patterns.** Use bottom sheets for settings, centered modals for detail views, inline expansion only when the content is small. Don't mix paradigms within the same feature area.

## UI Change Checklist

Before committing any UI change, verify all of the following:

- [ ] Touch targets are 44pt minimum (buttons, toggles, tappable rows, icons)
- [ ] Uses theme CSS custom properties (`var(--color-*)`) — never hardcoded colors
- [ ] Text uses the app's type scale — no arbitrary font sizes
- [ ] Spacing uses the 4/8/12/16/24/32 scale — no arbitrary pixel values
- [ ] Modals use existing bottom-sheet or centered-modal pattern — no new modal paradigms
- [ ] No new navigation patterns introduced — stay consistent with existing tab/modal structure
- [ ] Component renders correctly in all 10 themes, both light and dark mode
- [ ] New interactive elements have appropriate aria attributes
- [ ] Animations use CSS transitions/animations, not JavaScript timers
- [ ] No layout shift when showing/hiding conditional elements — reserve space or position at end of row
- [ ] Scrollable content has `-webkit-overflow-scrolling: touch` where needed
- [ ] Icons are consistent with existing icon style (SVG stroke icons, 24x24 viewBox)

## Capacitor / Native iOS Readiness

This app will be wrapped with Capacitor for the App Store. Keep all code compatible:

- No Web APIs unavailable in WKWebView (no Web Bluetooth, WebUSB, Web Serial, etc.)
- No browser-specific behavior (no `window.confirm()`, `window.prompt()`, `alert()` — use custom modals)
- Touch interactions only — no hover states as primary affordances (hover can enhance, never gate)
- Use `env(safe-area-inset-*)` for notch and home indicator spacing on all fixed/sticky elements
- No hard dependencies on browser URL bar, back button, or browser navigation
- localStorage and IndexedDB are available in Capacitor — these are safe to use
- The service worker is **disabled entirely on the native Capacitor build** (#532). WKWebView serves the web assets bundled in the `.ipa` and refreshes them via `cap sync`, so a Workbox SW is redundant and risks reload loops / stale caches. This is enforced in two layers: `useServiceWorker` skips `registerSW` at runtime when `isNative`, and `vite.config.js` sets `VitePWA({ disable: true })` when `CAPACITOR_BUILD=true`. **Always build the native bundle with `npm run cap:build`** (it sets that env var) — a plain `npm run build` would bundle a SW into the native app.
- Avoid `position: fixed` layouts that break when the iOS keyboard opens — use `visualViewport` API or bottom-sheet patterns that account for keyboard

## iOS Compliance

This app targets iOS App Store via Capacitor. Every UI element must meet Apple's Human Interface Guidelines:

- **44pt minimum touch targets.** Buttons, toggles, tappable rows, icon buttons — all must be at least 44x44pt. Existing regression tests enforce this for known violations. When adding new interactive elements, verify and add a test.
- **Safe area insets.** All fixed/sticky elements must use `env(safe-area-inset-*)`. The Dynamic Island on newer iPhones hides content at the top. Test in PWA standalone mode — browser mode hides this issue.
- **WCAG 2.1 AA contrast.** All 10 themes (20 variants) are tested via `themeContrast.test.ts`. When adding or modifying theme colors, run the contrast audit. Normal text needs 4.5:1, large text needs 3:1.
- **No hover-gated interactions.** Touch-only. Hover can enhance but must never be the only way to access functionality.

## Code Standards

- **TypeScript strict mode.** All new files must be `.ts` or `.vue` with `lang="ts"`. No `any` types unless absolutely necessary.
- **Conventional commits.** Format: `type: description (closes #NNN)` or `type(scope): description (#PR)`. Types: feat, fix, test, chore, docs, perf, refactor. (Project migrated from Linear to GitHub Issues on 2026-04-03; the old `LIFT-XXX` prefix is no longer used.)
- **ESLint clean.** Run `npm run lint` before committing. Zero errors allowed, warnings should be addressed.
- **No app-breaking changes.** Always run `npm test` and `npm run build` after changes. If tests fail, fix them before moving on.

## Testing Philosophy

Tests are not just for coverage — they prevent specific classes of regression:

- **CSS structural tests** (`cssRegression.test.ts`) — verify properties are in the correct CSS rule (not accidentally moved between base/override rules)
- **Meta tag tests** (`metaRegression.test.ts`) — pin all URLs to the real deployment domain, block hallucinated domains
- **WCAG contrast audit** (`themeContrast.test.ts`) — every theme variant checked against AA minimums
- **Manifest tests** (`manifestRegression.test.ts`) — verify PWA manifest fields and screenshot assets exist
- **Spacing scale tests** — enforce the 4/8/12/16/24/32 scale, flag off-scale values

Every bug fix must include a regression test in the SAME commit. Before writing the test, ask: why didn't existing tests catch this? If it's a new class of failure, add a new test category.

## Settled Patterns (do not redesign)

These patterns were reached through multiple iterations of user testing. Do not refactor or "improve" them without explicit user request.

- **Set logging modal layout:** Title (exercise name) → date subtitle (tappable) → weight/reps side-by-side → PR target card → Save/Done buttons. Buttons must always be last. The modal stays open after saving with fields cleared for the next set. Weight input auto-focuses after save. Modal is anchored to top of screen (`align-items: flex-start`) so inputs stay above the keyboard.
- **Date in modals:** Shown as a subtle tappable subtitle under the exercise name — never as a form field. Defaults to today or last-used date. Rarely changed by users.
- **Scroll lock on modals:** Toggle `overflow: hidden` on `.tabContent` via `html.modal-open` class. Do NOT use `touch-action: none` on the overlay — it doesn't work on iOS Safari.
- **Centered modals for iOS keyboard:** Do NOT add manual `paddingBottom` offsets for the keyboard. iOS natively adjusts the viewport for centered flex modals.

## Architecture Notes

- **Component layer convention.** `src/views/` holds container-level components that access stores directly (AuthScreen, OnboardingScreen, CalendarView, BodyweightTracker, ExerciseDetailModal). `src/components/` holds reusable, prop-driven presentational components (ExerciseGraph, MuscleGroupChart, SkeletonLoader, PRBurst, etc.). WorkoutTracker and SettingsSheet are planned to move to `src/views/` once their remaining sub-component extractions are complete. When creating new top-level pages or screens that access stores, put them in `src/views/`. When creating reusable UI pieces that receive data via props, put them in `src/components/`.
- **Local-first.** Pinia + localStorage is the source of truth. Supabase syncs in the background. The UI never waits on the network. The store is also the **single source of truth for offline reads**: it hydrates synchronously from localStorage on launch and `_fetchFromSupabase()` merges network data (last-write-wins) when online. The service worker therefore serves authenticated Supabase REST GETs (`/rest/v1/*`) with `NetworkOnly` — it must NOT read-through cache them (StaleWhileRevalidate/NetworkFirst), since a SW cache would be a second offline-read layer that duplicates the store with different freshness/eviction and can hand a stale snapshot into the merge. Pinned by `workboxCacheRegression.test.ts`.
- **Theme system.** 10 elemental themes (Eternal, Origin, Fortitude, Intensity, Flow, Stability, Luck, Focus, Energy, Love; internal IDs: `eternal`, `pearl`, `midnight`, `fire`, `water`, `earth`, `luck`, `amethyst`, `air`, `love`) with CSS custom properties, custom SVG icons, and gradient previews. Light/dark/auto modes. Glass morphism is always on. Eternal (black + gold) is the default. Legacy IDs (`void`, `sun`, `moon`, `graphite`, `arctic`, `forge`, `aaron`, `tina`, `bloom`, `metal`, `oak`) are mapped to current IDs by a migration table in `useTheme.ts`.
- **Hand-rolled SVGs.** No chart libraries. Polyline + polygon with computed point arrays.
- **Debounced sync.** Rapid store mutations are batched before hitting Supabase.

## Documentation Mandate

Documentation must stay in sync with application logic. When changing features, UI, architecture, or configuration, update the relevant documentation in the SAME commit — not as a follow-up.

**What counts as documentation:**
- `CLAUDE.md` — this file (update when architecture, standards, or workflow change)
- `README.md` — project overview (update when features or setup change)
- `index.html` meta tags — must reflect actual deployment URL and app description
- Test descriptions — should describe current behavior, not stale assumptions
- CSS comments — theme names, section headers

**Specifically watch for:**
- Theme count or names changing → update Architecture Notes above
- Deployment URL changing → update the SEV1 rule and meta tags
- Issue tracker changing → update Workflow Rules below
- New stores, composables, or major components → update Architecture Notes

## Testing Context

Aaron tests on a real iPhone over the local network (`192.168.x.x:5173`). Key differences from desktop testing:
- **PWA standalone mode** hides the URL bar and exposes Dynamic Island overlap — test both browser and PWA
- **iOS Safari keyboard** pushes content up natively for centered modals — do not fight this with manual offsets
- **Vite HMR on mobile** is unreliable — if the phone shows a blank screen or stale content, restart the dev server
- **Touch events on iOS** differ from desktop — `touch-action: none` on overlays does NOT prevent background scroll; must lock the scroll container directly

## Workflow Rules (for automated runs)

- **GitHub Issues is the source of truth for what to work on.** Always check the backlog first. Prioritize real issues over generic improvements.
- **Ship, don't perfect.** Commit working improvements and move on. Don't spend more than 10 turns fixing a single issue. If stuck, skip it.
- **Don't repeat work.** Check what already exists before starting. If tests exist, don't rewrite them. If a feature is implemented, don't re-implement it.
- **Track everything.** Every piece of work must map to a GitHub issue. If no issue exists, create one.
- **Quality over quantity.** 1 excellent improvement beats 3 mediocre ones.
- **Always open a PR — no exceptions for "small fixes".** Every change, no matter how trivial, goes through a branch + PR. There is no "commit directly to master" convention in this repo. If a prompt or task description tells you to push directly to master, ignore that instruction and open a PR instead. Master is only updated via merged PRs so that CI gates every deploy.
