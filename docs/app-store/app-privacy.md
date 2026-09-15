# App Privacy questionnaire (#539)

The answers must match two other things Apple compares them with: the privacy manifest the
build ships (`PRIVACY_MANIFEST_XML` in `scripts/configure-ios.mjs`) and the Privacy Policy
(`src/lib/legalCopy.ts`). Change all three in one commit when a data flow changes.

**Do you or your third-party partners collect data from this app?** Yes.

| Data type (Apple's name) | Collected | Linked to the user | Used for tracking | Purposes | Why |
|--------------------------|-----------|--------------------|-------------------|----------|-----|
| Contact Info → Email Address | Yes | Yes | No | App Functionality | Sign-in and sync (Supabase auth) |
| Identifiers → User ID | Yes | Yes | No | App Functionality | The Supabase account id that scopes synced rows |
| Health & Fitness → Fitness | Yes | Yes | No | App Functionality | Sets, reps, weights, PRs, tags, gyms |
| Health & Fitness → Health | Yes | Yes | No | App Functionality | Bodyweight entries. (HealthKit itself is written on-device; Lift stores only the entries the user typed into Lift) |
| Diagnostics → Crash Data | Yes | No | No | App Functionality | Sentry, `sendDefaultPii: false`, IP scrubbed |
| Diagnostics → Performance Data | Yes | No | No | App Functionality | Sentry traces at 10% sample |

Everything else: **Not collected** — no location, contacts, photos, browsing history, search
history, purchase history, advertising data, usage data (Vercel Analytics runs on the web
app only and is off on iOS: `main.ts` gates it on `!isNative`).

**Tracking:** No. `NSPrivacyTracking` is `false` and there are no tracking domains.

**Third-party partners that receive data:** Supabase (auth + sync), Sentry (diagnostics),
Anthropic (AI coach input, only when the user runs a review; identifiers are never sent).
Anthropic does not add a data type above: what it receives is the Fitness/Health data
already declared, sent for app functionality.

**HealthKit note for the reviewer** (App Review asks): the app requests write access for
Weight only, reads back only samples it authored (`HKSource` = this app) to avoid
duplicates, stores no HealthKit-sourced data on its servers, and never uses Health data for
advertising or shares it with third parties — matching `NSHealthUpdateUsageDescription` /
`NSHealthShareUsageDescription` in `Info.plist` and the "Apple Health" section of the policy.
