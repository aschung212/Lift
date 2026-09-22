# App Store Connect record (#539)

Aaron-only (App Store Connect web UI). Copy from here; everything below is derived from the
app's own metadata (`src/lib/appMeta.ts`, `index.html`) so the store listing says what the
web listing says.

## Name

The app is **Logbook** — `APP_NAME` in `src/lib/appMeta.ts`, the PWA `short_name`, and
`CFBundleDisplayName` in the committed `ios/` project all carry it. Check whether the bare
name is free with the name reservation tool when creating the record (it answers
immediately); if it is taken, reserve one of these instead, in order of preference:

1. **Logbook — Workout Tracker** (the og:title the site already uses)
2. **Logbook: Workout Tracker**
3. **Logbook Workout Log by Aaron Chung**

The in-app name stays "Logbook" (`CFBundleDisplayName`) regardless of the store name. The
bundle ID (`com.aschung212.lift`) and SKU (`lift-ios`) keep the original codename: they are
identity, not branding, and cannot change once the record exists.

## Fields

| Field | Value |
|-------|-------|
| Subtitle (30) | `Log sets, track PRs, no paywall` |
| Category | Health & Fitness (primary), Sports (secondary) |
| Price | Free, no in-app purchases |
| Age rating | 4+ (no objectionable content; the questionnaire's medical/treatment answer is "None" — the AI coach is training feedback, not medical advice, and the terms say so) |
| Privacy Policy URL | `https://spa-rho-sandy.vercel.app/legal/privacy.html` |
| Support URL | `https://github.com/aschung212/Lift/issues` |
| Marketing URL | `https://spa-rho-sandy.vercel.app` |
| Copyright | `2026 Aaron Chung` |
| Bundle ID | `com.aschung212.lift` |
| SKU | `lift-ios` |

## Promotional text (170)

`Free forever, no paywall. Log every set, watch your estimated 1RM climb, and hit new PRs. Syncs across devices and writes your weigh-ins to Apple Health.`

## Description (4000)

```
Logbook is a workout tracker that stays out of your way. Log weight and reps in two taps,
and Logbook does the rest: estimated one-rep max on every set, PR detection with a trophy on
the row that earned it, and a chart per exercise that shows where your strength is going.

TRACK
• Unlimited exercises and full history — free, no paywall, no ads
• Estimated 1RM (Epley) on every set; PRs highlighted the moment you log them
• Per-exercise progress charts and a PR history with days between records
• Tags and gyms: filter to the muscle group or the gym you are at today
• Rest timer with presets and warnings
• Bodyweight log with trend, goal line, and Apple Health sync

PLAN
• Repeat last session: your history is the template
• Suggestions from your own routine — the next rung, the rep target that beats your best
• Intensity presets that turn a percentage of your max into a loadable weight, plate math included

KEEP
• Local-first: everything works offline; sign in to sync across devices
• Export CSV or JSON any time; delete your account and data in-app
• Ten themes unlocked by training, light and dark

PRIVACY
Logbook stores what you enter and nothing else. No ads, no tracking, no selling data. Apple
Health sync is opt-in and write-only. Full policy: spa-rho-sandy.vercel.app/legal/privacy.html
```

## Keywords (100 chars, comma-separated)

`workout,lifting,gym,log,strength,1RM,PR,bodyweight,tracker,sets,reps,barbell,powerlifting`

## What's New (first version)

`First App Store release.`

## Screenshots

Required size: **6.9-inch** (iPhone 17 Pro Max class), portrait, **1320 × 2868** px — which
is exactly what a screenshot on Aaron's own iPhone 17 Pro Max produces, with real data,
which beats the Simulator's sample-data banner. Take 5–8, in this order, in the Eternal
theme (dark):

1. Workouts tab with the exercise list, tags and a PR badge visible
2. The log sheet mid-set: weight/reps, the Suggestions drawer, plate calculator
3. An exercise detail with the progress chart and PR history
4. Calendar / week view
5. Weight tab with the chart and goal line
6. Settings → Apple Health switch on (shows the native integration)
7. A theme that is not the default, to show the unlock system

Optional: 6.5-inch (1284 × 2778) — App Store Connect scales the 6.9-inch set for smaller
phones if these are omitted. iPad screenshots are not needed: the target is iPhone-only.

## App Review information

- Demo account: create `review@` + the contact domain, or any email, with a password, and
  put the credentials in the review notes. Guest mode ("Continue without an account")
  also lets a reviewer in with no account at all — say so in the notes.
- Notes template:

```
Logbook is a workout tracker. No account is required (tap "Continue without an account");
a demo account is provided above for the synced experience. Apple Health is used only to
WRITE bodyweight entries the user logs, opt-in from Settings → Apple Health; the app reads
back only the samples it wrote. There is no third-party sign-in on this build; Sign in
with Apple will ship together with Google sign-in in a later version. Account deletion is
in Settings → Danger Zone → Delete Account.
```
