# TestFlight runbook (#540)

Needs the paid membership (step 1 in the README). Aaron runs this; nothing here is
automated yet — after two or three uploads by hand, Xcode Cloud or a fastlane lane is the
obvious next step and can be a new issue.

## One-time

1. Xcode → Settings → Accounts: the Apple ID now shows the paid team beside the Personal
   Team. In `ios/App/App.xcodeproj` → App target → Signing & Capabilities, switch **Team**
   to the paid team (automatic signing stays on; Xcode creates the distribution certificate
   and App Store profile, HealthKit included). This changes `DEVELOPMENT_TEAM` in the
   committed `project.pbxproj` — commit it, it is the shipping team.
2. App Store Connect → My Apps → **+** → New App: iOS, the reserved name, `com.aschung212.lift`,
   SKU `lift-ios`. Fill the record from [listing.md](listing.md) and
   [app-privacy.md](app-privacy.md).
3. Supabase: add `{{ .Token }}` to the Reset Password email template (README → Deploy).

## Every build

```bash
npm run cap:build      # web bundle → ios/, stamps MARKETING_VERSION + build number
npm run cap:open:ios
```

Run `cap:build` **from the shell you are about to archive from**, and never archive on top
of a live-reload sync. `CAPACITOR_DEV_URL` points the WebView at the Vite dev server, and
`cap sync` bakes that into `ios/App/App/capacitor.config.json`, which is gitignored and
copied into the `.ipa` — an archive taken from it loads its entire UI over plaintext HTTP
from a LAN address and looks perfectly normal until it is installed (LIFT-1435).
`cap:build` sets `CAPACITOR_BUILD=true`, so it ignores that variable, and its last step
(`npm run guard:native-config`) re-checks the file that was actually emitted.

Its second-to-last step (`npm run guard:dev-surface -- --native`) greps the copied bundle
in `ios/App/App/public` for the "Continue as Dev" auth bypass and the Settings dev tools
(LIFT-1454). CI runs that guard against a `dist/` **it** built; `cap:build` builds its own,
so this is the only check that ever sees the bundle an archive embeds. The way those
surfaces get in is `VITE_E2E=true` in the shell you archive from — and Vite reads
`.env.local` / `.env.*` for every build, so it does not have to be exported by hand.

In Xcode: destination **Any iOS Device (arm64)** → Product → **Archive** → Organizer →
**Distribute App** → App Store Connect → Upload (keep the defaults: upload symbols, manage
version and build number OFF — the hook already stamped them). The export-compliance
question does not appear because `ITSAppUsesNonExemptEncryption` is `false` in Info.plist.

The build number is the commit count on the branch, so **archive from `master`** and never
twice from the same commit (App Store Connect rejects a reused number; a new commit fixes
it). For a new store version bump `version` in `package.json` first.

## Internal testing (instant)

App Store Connect → TestFlight → Internal Testing → create a group, add Aaron's Apple ID
(and any collaborator on the team). The build appears after processing (5–20 min). Install
the TestFlight app on the phone, accept, install. Dogfood a few days.

## External testing (friends)

TestFlight → External Testing → create a group → **Enable Public Link** → add the build.
The first external build goes through **Beta App Review** (usually within a day; the same
review notes as [listing.md](listing.md#app-review-information) apply). Send the link;
testers need only the TestFlight app. Limits: 10,000 testers, builds expire after 90 days,
so re-upload at least quarterly while in beta.

## When something goes wrong

- `guard:native-config` fails with "points the app at a dev server": the sync came from a
  live-reload session. `unset CAPACITOR_DEV_URL` and re-run `npm run cap:build`.
- `guard:dev-surface` fails with "leaked into the production bundle": `VITE_E2E` is set in
  this shell or in a `.env.local` / `.env.*` file. Unset it (or delete the line) and re-run
  `npm run cap:build` — the bundle already copied into `ios/App/App/public` carries the
  surface, so re-syncing is required, not optional.
- The installed build shows a blank screen or a "cannot connect" error: same cause, reached
  by archiving before the guard existed. Check `ios/App/App/capacitor.config.json` for
  `server.url`.
- "Missing compliance": the Info.plist key was lost — `npm run cap:configure:ios` re-applies it.
- "Invalid bundle / iPad": `TARGETED_DEVICE_FAMILY` must be `1`; same fix.
- "Missing privacy manifest": `PrivacyInfo.xcprivacy` is not in Copy Bundle Resources; same fix
  (`configure-ios.test.mjs` fails locally if the committed project drifted).
- Signing errors after regenerating `ios/`: the team is per-machine in Xcode's Accounts, not
  in the repo; select it again under Signing & Capabilities.
