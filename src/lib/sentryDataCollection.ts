import type { init } from '@sentry/vue'

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>['dataCollection']>

/**
 * What the Sentry SDK may collect on its own (LIFT-533).
 *
 * Sentry 11 removed `sendDefaultPii` and replaced it with `dataCollection`,
 * whose defaults all collect: user info (so the ingest infers the client IP),
 * cookies, request/response headers and HTTP bodies. Dropping the old option
 * without this block therefore turned IP inference back ON, contradicting the
 * App Privacy answers and the iOS privacy manifest ("crash data, not linked to
 * the user"). Every field here is an explicit opt-out for that reason: an
 * omitted field means "the SDK default", and the SDK default is to collect.
 *
 * Kept as its own module (type-only import, so `@sentry/vue` stays lazy-loaded
 * in main.ts) so a test can read the resolved values rather than grep for an
 * option name, which is what let the upgrade look harmless.
 */
export const SENTRY_DATA_COLLECTION = {
  // Also sets the ingest's infer_ip to "never".
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  // The password-reset landing carries a one-time `?code=` (#1430).
  urlQueryParams: false,
} as const satisfies DataCollection
