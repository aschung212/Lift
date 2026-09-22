# App Review compliance checklist (#541)

Status as of 2026-09-15. "Done" means it ships on `master`; "Aaron" means a step only he can
take; "Open" names the issue.

## Guidelines

| Guideline | Requirement | Status |
|-----------|-------------|--------|
| 2.1 App Completeness | No placeholder content, no debug surfaces, no broken links | Done — dev tools removed from production builds (#1425, `check-no-dev-surface.js` in CI); the bundle cannot be pointed at a dev server (LIFT-1435, `guard:native-config` in `cap:build`); legal links live (#1432) |
| 2.3 Accurate Metadata | Screenshots and description show the real app | Aaron — [listing.md](listing.md) |
| 2.5.1 Software Requirements | Public APIs only | Done — Capacitor + `@capgo/capacitor-health` use public APIs; privacy manifests ship for required-reason APIs (#1429) |
| 3.1 Payments | No IAP, no external payment links | Done — nothing to sell |
| 4.0 Design | Native feel: status bar, safe areas, keyboard | Done — #1423 (`contentInset: never`, native keyboard resize) |
| 4.2 Minimum Functionality | Not a repackaged website | Done — HealthKit write, haptics, share sheet, offline local-first data; describe these in the review notes |
| 4.8 Login Services | Sign in with Apple required if any third-party login is offered | **N/A on this build** — the native auth screen offers email/password + guest only (#1431). Google (#1426) and Apple (#542) must ship together |
| 5.1.1(i) Privacy Policy | Policy URL in the record and in-app | Done — `/legal/privacy.html`, Settings → Legal |
| 5.1.1(ii) Permission | Usage strings explain HealthKit access | Done — `NSHealthUpdateUsageDescription`, `NSHealthShareUsageDescription` (#1421) |
| 5.1.1(v) Account Deletion | In-app deletion of the account and its data | Done — Settings → Danger Zone → Delete Account (#1299); guests: Delete All Data (LIFT-1310) |
| 5.1.2 Data Use and Sharing | App Privacy answers match the actual flows | Done in docs — [app-privacy.md](app-privacy.md) mirrors the manifest and the policy; Aaron enters them |
| 5.1.3 Health and Fitness | Health data not for advertising, not shared, not stored in iCloud by the app; policy covers it | Done — write-only weight, reads only own samples, policy section "Apple Health" (#1432) |
| 5.1.4 Kids | Not a kids app | Done — 4+ rating, policy states not directed at under-13s |

## Before pressing Submit

- [ ] App Privacy questionnaire entered exactly as [app-privacy.md](app-privacy.md)
- [ ] Privacy Policy URL resolves (open it in Safari on the phone)
- [ ] Demo account created and working; review notes pasted from [listing.md](listing.md)
- [ ] External TestFlight build has been used by at least one friend on their own device (#540)
- [ ] Build number is fresh (archived from `master` after the last merge)
- [ ] `npm run cap:build` ran green in the shell the archive was cut from — its last step
      (`guard:native-config`) is what proves the bundle loads its UI from inside the app
      and not from a LAN dev server (LIFT-1435)
- [ ] Airplane mode on the phone: the installed build still opens and logs a set (a
      dev-server origin looks fine on the wifi it was built on and fails everywhere else)
- [ ] Supabase Reset Password template carries `{{ .Token }}` (or "Forgot password" in the app cannot complete)

## If rejected

Reply in Resolution Center with specifics; file a Logbook issue for any code change; the
common first-submission rejections and their answers are already handled above
(Sign in with Apple — none offered; privacy URL — live; demo credentials — provided;
HealthKit justification — in the notes and the policy).
