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

- **Set logging modal layout:** Title (exercise name) → date subtitle (tappable) → Suggestions drawer (consolidated ladder / intensity lenses, see Architecture Notes) → contextual e1RM/PR-target card → weight/reps side-by-side → plate calculator → Save/Done buttons. Buttons must always be last. The modal stays open after saving with fields cleared for the next set. Weight input auto-focuses after save. Modal is anchored to top of screen (`align-items: flex-start`) so inputs stay above the keyboard. Save/Done live in a sticky action bar pinned to the bottom of the log sheet (`.logSetSheetForm .repMaxActions` — flex-column sheet, `margin-top: auto`, `position: sticky`) so they are always visible without scrolling; form content scrolls behind the frosted bar. Do not move the buttons back into the scroll flow.
- **Date in modals:** Shown as a subtle tappable subtitle under the exercise name — never as a form field. Defaults to today or last-used date. Rarely changed by users.
- **Scroll lock on modals:** Toggle `overflow: hidden` on `.tabContent` via `html.modal-open` class. Do NOT use `touch-action: none` on the overlay — it doesn't work on iOS Safari. This lock is **mandatory, not cosmetic**: a `position: fixed` modal whose background stays scrollable desyncs its paint from its hit-test coordinates when the iOS keyboard opens (visual viewport shifts, layout viewport doesn't), so taps land a row low (#830). `useModal` now **owns this centrally** via a reference-counted lock (acquired in `open()`, released on `close()`/unmount), so any modal built on `useModal` is locked automatically — never re-add an ad-hoc `classList.toggle('modal-open', …)`. Pass `lockScroll: false` only when an ancestor modal already owns the lock for that surface (e.g. `SharePickerSheet` nested under `WorkoutCompleteView`/`PRBurst`).
- **Centered modals for iOS keyboard:** Do NOT add manual `paddingBottom` offsets for the keyboard. iOS natively adjusts the viewport for centered flex modals.

## Architecture Notes

- **Component layer convention.** `src/views/` holds container-level components that access stores directly (AuthScreen, OnboardingScreen, CalendarView, BodyweightTracker, ExerciseDetailModal). `src/components/` holds reusable, prop-driven presentational components (ExerciseGraph, MuscleGroupChart, SkeletonLoader, PRBurst, etc.). WorkoutTracker and SettingsSheet are planned to move to `src/views/` once their remaining sub-component extractions are complete; extracted so far as props+emits children: WorkoutTimeline, EditExerciseModal, TagManagerModal, ExercisePickerModal (from WorkoutTracker, alongside the earlier RestTimerContent/WorkoutCompleteView) and LegalSheet, ThemeStatsSheet (from SettingsSheet) — the log-set modal intentionally remains inline (settled pattern). When creating new top-level pages or screens that access stores, put them in `src/views/`. When creating reusable UI pieces that receive data via props, put them in `src/components/`.
- **Rest timer composables (LIFT-879).** `useRestTimerController` is a thin orchestrator that owns the countdown loop, pause/restart/stop, notification integration, and the disable/undo flow, and composes two single-responsibility helpers: `useRestTimerPresets` (duration presets + their localStorage persistence + add/remove/toggle) and `useRestTimerAlerts` (configurable warning-time state + persistence + the Web Audio warning/finish beeps and the AudioContext they run on). The controller re-exposes the preset/alert fields by delegation so `RestTimerContent.vue` still consumes a single `RestTimerController` surface (unchanged public interface). `useRestTimer` remains the settings-only flag holder (rest-timer enabled/autostart, bound to the preferences store) — distinct from the controller. The AudioContext is instance-scoped in `useRestTimerAlerts` (the controller is its sole consumer); beeps are no-ops until `ensureAudio()` runs on a user gesture.
- **Shared date helpers live in `src/lib/dates.ts`** (`todayISO`, `toLocalDateKey`, `setDayKey`, `formatShortDate`, `daysBetweenISO`). The app's mental model is the LOCAL calendar day while the store persists UTC ISO timestamps — never derive a day key via `toISOString().slice(0, 10)`; it rolls evening dates to tomorrow in US timezones (this bug was independently fixed three times before the module existed). **Set/bodyweight dates carry two storage conventions and MUST be bucketed via `setDayKey` (#746):** UI-logged sets are written with `endOfDayISO(localDay)` → `…T23:59:ssZ` where the prefix IS the chosen local day (so `slice(0, 10)` is right and `toLocalDateKey` would shift +1 east of UTC), while the `logSet` no-date fallback and legacy data are real-time UTC instants (where `toLocalDateKey` is right and `slice(0, 10)` rolls Americas evenings to tomorrow). `setDayKey` detects the `23:59` end-of-day window (same string check as `sessionSummary.isEndOfDayJitter`) and routes accordingly — it is the single reconciliation point; never blanket-swap one derivation for the other. `src/lib/storage.ts` provides `loadJSON` for guarded localStorage reads — corrupt storage must never throw into store init.
- **Local-first.** Pinia + localStorage is the source of truth. Supabase syncs in the background. The UI never waits on the network.
- **Settings ownership (LIFT-821).** The `preferences` store is the single source of truth for synced appearance/behavior settings. `useWeightUnit` and `useRestTimer` are thin accessors whose refs are **writable computeds bound to the store** (`weightUnit`, `restTimerEnabled`, `restTimerAutoStart`) — they hold no module-scope ref and never touch localStorage directly, so a change made via the composable and one made via the store can't diverge. `theme` and `colorMode` still live as module-scope refs in `useTheme` because the pre-Pinia FOUC bootstrap (`initTheme` in `main.ts`, before `app.use(pinia)`) reads `app-theme`/`app-mode` from localStorage and applies them to the DOM. Those two are reconciled to the store after hydration by `syncSettingsWithComposables()` (in `useAuth`), which pushes the hydrated store value into the refs once and sets a one-directional ref→store watcher. `_persist` still writes the legacy individual keys (`app-theme`, `app-mode`, `weight-unit`, `rest-timer`, `rest-timer-autostart`) for FOUC/migration, but from the single store owner in one atomic write. Folding `theme`/`colorMode` into the store (removing the last bridge) remains the open tail of LIFT-821.
- **Theme system.** 10 elemental themes (Eternal, Origin, Fortitude, Intensity, Flow, Stability, Luck, Focus, Energy, Love; internal IDs: `eternal`, `pearl`, `midnight`, `fire`, `water`, `earth`, `luck`, `amethyst`, `air`, `love`) with CSS custom properties, custom SVG icons, and gradient previews. Light/dark/auto modes. Glass morphism is always on. Eternal (black + gold) is the default. Legacy IDs (`void`, `sun`, `moon`, `graphite`, `arctic`, `forge`, `aaron`, `tina`, `bloom`, `metal`, `oak`) are mapped to current IDs by a migration table in `useTheme.ts`.
- **Usual ladder + ghost logging.** `workout.ts` exposes `getUsualLadder` (pure read): per-position weight clustering (±1 lb) over the last ≤6 prior sessions detects a user's habitual set progression (≥3 sessions, ≥60% support, ≥3-rung consensus prefix; a 'recent' tail carries a drifting top set from the last session). The log modal renders it as the **Routine lens** of the Suggestions drawer (#759) — routine-aware chips (done/next/skipped states derived purely from today's logged sets — no local state) shown by default and expanded so the flow stays one-tap; and when both fields are empty the next rung "ghost-arms" as input placeholders with Save relabeled to its payload (e.g. "Save 135 × 10") — one tap per habitual set; fields stay genuinely cleared after save, per the settled pattern. The overload nudge surfaces `getOverloadSuggestion` (now carrying a `confidence` field) only when the habitual top set is up next, high-confidence only, rate-limited via the device-local localStorage key `overload-nudge-state` (1/day global cap, 7-day per-exercise cooldown, 14/28-day ignore backoff, then muted until the top weight changes) — deliberately NOT synced (not in preferences, not on Exercise).
- **Suggestions drawer (#759 / #770 / #774).** The log-set modal consolidates every "what should my next set be?" affordance into ONE segmented disclosure (`.wtSuggestions`, reusing the `wtPrTargets` card chrome). A `currentLens` (`'routine' | 'last' | 'intensity'`) selects the body; `suggestionLenses` lists only those with data (routine OR last, then intensity when a PR exists to anchor to). The drawer opens **expanded on the quick-fill lens** (routine when a ladder exists, else last-session) so the one-tap ghost-arm flow is never an extra tap away; the intensity slider sits behind the segmented control. See the Intensity-lens note below. The live e1RM estimate stays inline near the inputs (it's feedback that reacts to typing, not a suggestion menu). Segments and the intensity slider are 44pt for iOS HIG (regression-tested in `cssRegression.test.ts`).
- **Intensity lens (#770 / #774).** One PR/1RM-anchored lens off the exercise's best e1RM (`getExercisePR`). `src/lib/intensityTable.ts` → `generateIntensityTable` (pure) takes a 1RM + an intensity % and, per rep count, inverts Epley (1 rep = the 1RM itself, no multiplier) to find the **lightest LOADABLE** weight whose e1RM **meets or beats** that intensity — i.e. weights are **ceiled** to a plate increment. **Ceiling (not flooring) is the load-bearing choice (#774):** it lets a single lens span warmups (low %) through PR-beating loads (100%), so the former separate "PR" table is just this table read at 100% — the two lenses were merged. A slider (0–100% in 5% steps, default 80%) drives it; each row carries its `e1rm` (shown as `~N {unit} e1RM`). **Tappable intensity presets (#776)** sit above the slider as the fast path — a `wtPrevSessionChip` per configured % that sets `intensityPct` on tap (active chip = `wtPrevSessionChipNext`); the slider stays for one-off values. Presets are a **global, synced preference** (`preferences.intensityPresets`, default `[50,70,80,90,100]`) — NOT per-exercise — stored in the `user_preferences` JSONB blob (no migration), sanitized by `sanitizeIntensityPresets` (int, [1,100], dedupe, sort, cap `MAX_INTENSITY_PRESETS=8`; `[]` = slider-only, kept distinct from "never set" → defaults). Edited in Settings → **Intensity Presets** (stepper ±5 in [5,100] + delete + add); pure step/add helpers (`nextPresetValue`, `pickNewPresetValue`) skip occupied values so two presets never collapse. The rep-row count is **configurable per exercise** via `Exercise.intensityMaxReps` (default 10, clamped to [1, 100]) — and now governs the whole table including the PR-beating top end. Edited in the "Intensity" section of `EditExerciseModal`, set through `setExerciseIntensityMaxReps`, validated by `sanitizeIntensityMaxReps` at every boundary (store setter, localStorage load, remote fetch). It **syncs** via the additive `intensity_max_reps` integer column (like `bar_weight`) — the upsert always sends the value (null when unset) so "reset to default" clears it server-side. Reps are NOT prescribed: the user taps the row matching their planned reps. In plate mode a target below the empty bar is dropped (slider shows "slide higher"). This supersedes the LIFT-725 warmup ramp (low intensity = warmups now); `warmupGenerator.ts` and the `warmup_scheme` column were retired/left dormant in #770.
- **Set scoring (`src/lib/setScoring.ts`).** The PR/zone/rep-PR/XP derivation for a single set lives in one pure `scoreSet(...)` function. WorkoutTracker previously carried three near-identical copies of this logic (the real log path `computeAndLogXP`, the live-preview `_computeXPPreview`, and the edit-recalc path in `saveSet`) — a drift hazard where a tweak to one silently missed the others. `scoreSet` takes `priorSets` (all sets EXCLUDING the one being scored), the candidate's `estimated1RM`/`weightLbs`/`reps`, the `dateKey`, and the PR `baseline`, and returns the established `best1RM`, `isPR`/`isTie`/`isPRZone`/`isRepPR`/`isNewWeight` flags, the `ratio`, the canonical machine `zone` (`warmup`/`working`/`pr`/`tie`/`new_exercise`), and `baseXP` (streak multiplier applied by the caller). Components format for their surface (machine zone for storage, display string for the preview) rather than re-deriving. `filterSetsSinceBaseline(sets, baseline)` also lives here (bucketed via `setDayKey`, per #746).
- **Celebration moments.** Two tiers, both gated behind the single `experience.prCelebrations` opt-out. A genuine e1RM PR fires the full-bleed `PRBurst` takeover (`usePRBurst`). Meeting the weekly training goal fires the lighter, auto-dismissing `GoalCelebration` banner (`useGoalCelebration`) — once per Mon–Sun week, with a "milestone" variant when the projected streak crosses a duration-multiplier tier (2/4/8/12 weeks). The once-per-week guard is device-local (`goal-celebration-state` in localStorage, deliberately NOT synced, like the overload nudge); pure decision logic lives in `src/lib/goalCelebration.ts` (`decideGoalCelebration`). WorkoutTracker's `saveSet` skips the goal banner while a PR burst is showing (leaving the week unmarked so it still fires on the next non-PR set).
- **Hand-rolled SVGs.** No chart libraries. Polyline + polygon with computed point arrays.
- **Debounced sync.** Rapid store mutations are batched before hitting Supabase.
- **Durable write queue.** Workout writes enqueued via `syncQueue` can carry a serializable `SyncDescriptor` (upsert/update only — idempotent for safe replay). Descriptors are journaled to IndexedDB so pending offline writes survive a tab close and are replayed on next launch via `syncQueue.rehydrate()` (called from `useAuth.initStores`). The journal is wiped on sign-out so a shared device never replays the previous user's writes. Reconciliation in `_fetchFromSupabase` is the second line of defense: it re-pushes local sets missing from the server even on remote-winning exercises (union-then-push). The Background Sync API is intentionally not used — iOS/WKWebView, the App Store target, lacks it.
- **Session health / token expiry (LIFT-784).** The Supabase client is created with explicit `auth` options (`persistSession`, `autoRefreshToken`, `detectSessionInUrl`). Because supabase-js's visibility-driven refresh timer is unreliable in WKWebView/Capacitor on resume from background, `useAuth.setupSessionRefreshLifecycle` re-arms `startAutoRefresh()`/`stopAutoRefresh()` on `visibilitychange` + `focus` + `pageshow`. `src/lib/sessionHealth.ts` distinguishes a 401/JWT-expiry (`isAuthError` — checks status/`PGRST301`/`PGRST303`/message) from an offline error, and `ensureFreshSession()` does a single-flight `refreshSession()` so a wave of stale-token writes triggers ONE refresh. The write path (`syncQueue.flush`) treats a *resolved* auth error — not just a rejection — as a retryable failure (a 401 resolves `{ error }`, so it used to be silently dropped as success) and fires `ensureFreshSession()` once per batch; read paths (`_fetchFromSupabase` in the workout/bodyweight stores) do the same. If refresh fails, the reactive `authNeedsReauth` flag drives a non-blocking "Session expired — sign in again" banner in `App.vue`; it clears on the `TOKEN_REFRESHED`/`SIGNED_IN` auth event.

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
