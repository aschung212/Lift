# App Store submission — the path, in order

Everything Logbook needs to ship to TestFlight and the App Store, with what is done, what is
Aaron-only, and where each artifact lives. Parent epic: #216. The trigger fired on
2026-09-15 (Aaron chose to share the app with friends), so the "blocked-indefinite" issues
under #216 are live.

| # | Step | Who | Status | Where |
|---|------|-----|--------|-------|
| 1 | Enroll in the Apple Developer Program (individual, $99/yr) | Aaron | pending | developer.apple.com — needs payment + identity; approval takes a day or two |
| 2 | Native project committed: icon, launch screen, privacy manifest, iPhone-only, export-compliance key, version stamping | done | #1429 | `ios/`, `scripts/configure-ios.mjs` |
| 3 | Password reset in the app; native sign-in without Google | done | #1431 | `src/views/AuthScreen.vue`, `useAuth` |
| 4 | Privacy Policy + Terms at public URLs | done | #1432 | `/legal/privacy.html`, `/legal/terms.html` (source: `src/lib/legalCopy.ts`) |
| 5 | Supabase "Reset Password" email template includes `{{ .Token }}` | Aaron | pending | Supabase → Authentication → Email Templates |
| 6 | App Store Connect record: name, category, privacy URL, App Privacy answers | Aaron | pending | [listing.md](listing.md), [app-privacy.md](app-privacy.md) |
| 7 | Screenshots (6.9-inch) | Aaron | pending | [listing.md → Screenshots](listing.md#screenshots) |
| 8 | Archive + upload; TestFlight internal, then external with a public link | Aaron (runbook here) | pending | [testflight.md](testflight.md) |
| 9 | Review checklist + submit | Aaron | pending | [review-checklist.md](review-checklist.md) |

Not required for v1, tracked separately: native Google sign-in (#1426) and Sign in with
Apple (#542) ship together; Apple Health edits/deletions (#1422); HealthKit read (#543).

## Things that are the same everywhere (do not retype)

- Bundle ID: `com.aschung212.lift` (`capacitor.config.ts`, pinned by `appMeta.test.ts`).
- Production site: `https://spa-rho-sandy.vercel.app` (CLAUDE.md is the source; never guess it).
- Privacy policy URL: `https://spa-rho-sandy.vercel.app/legal/privacy.html`.
- Terms URL: `https://spa-rho-sandy.vercel.app/legal/terms.html`.
- Support URL: `https://github.com/aschung212/Lift/issues` (or the site).
- Contact email: `aaronschung@gmail.com` (the address the privacy policy names).
- Version: `MARKETING_VERSION` comes from `package.json` (`1.0.0`); the build number is the
  commit count and is stamped by `npm run cap:build`. Bump `package.json` for a new store
  version; archive from `master`.
