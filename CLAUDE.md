# Lift — Claude Guidelines

## About This Project
Lift is Aaron Chung's primary portfolio project — a mobile-first PWA workout tracker. Aaron is an ex-AWS SDE2 targeting SWE roles at companies like Notion, Airtable, and Linear. This app needs to demonstrate engineering rigor and product taste.

**Live:** spa-rho-sandy.vercel.app
**Linear:** linear.app/masterchung → Lift project (team: MAS)
**Deploy:** Vercel auto-deploys from master. Never push directly to master.

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
- [ ] Component renders correctly in all 6 themes, both light and dark mode
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
- Test that service worker behavior degrades gracefully when running in Capacitor (native apps handle caching differently)
- Avoid `position: fixed` layouts that break when the iOS keyboard opens — use `visualViewport` API or bottom-sheet patterns that account for keyboard

## Code Standards

- **TypeScript strict mode.** All new files must be `.ts` or `.vue` with `lang="ts"`. No `any` types unless absolutely necessary.
- **Tests required.** Every new feature or store change needs corresponding Vitest tests. Aim for meaningful coverage — no trivial "it exists" tests.
- **ESLint clean.** Run `npm run lint` before committing. Zero errors allowed, warnings should be addressed.
- **Conventional commits.** Format: `type: description (MAS-XXX)`. Types: feat, fix, test, chore, docs, perf, refactor.
- **No app-breaking changes.** Always run `npm test` and `npm run build` after changes. If tests fail, fix them before moving on.

## Architecture Notes

- **Local-first.** Pinia + localStorage is the source of truth. Supabase syncs in the background. The UI never waits on the network.
- **Theme system.** 6 themes with CSS custom properties. Light/dark/auto modes. Glass morphism is opt-in.
- **Hand-rolled SVGs.** No chart libraries. Polyline + polygon with computed point arrays.
- **Debounced sync.** Rapid store mutations are batched before hitting Supabase.

## Workflow Rules (for automated runs)

- **Linear is the source of truth for what to work on.** Always check the backlog first. Prioritize real issues over generic improvements.
- **Ship, don't perfect.** Commit working improvements and move on. Don't spend more than 10 turns fixing a single issue. If stuck, skip it.
- **Don't repeat work.** Check what already exists before starting. If tests exist, don't rewrite them. If a feature is implemented, don't re-implement it.
- **Track everything.** Every piece of work must map to a Linear issue. If no issue exists, create one.
- **Quality over quantity.** 1 excellent improvement beats 3 mediocre ones.
