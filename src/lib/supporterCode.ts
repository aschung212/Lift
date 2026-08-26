/**
 * Web-sponsor Supporter code verification (LIFT-1204).
 *
 * The native App Store path (LIFT-598) will grant the Supporter entitlement via
 * RevenueCat/IAP. But the web build's revenue channel is GitHub Sponsors / Buy
 * Me a Coffee, and a paying web sponsor had no way to actually RECEIVE the
 * perks they funded (clean share cards #601, data export #603) — the entitlement
 * was hard-coded off with no grant path. This module is that grant path: a
 * sponsor redeems a code, we verify it here, and the preferences store flips a
 * synced `isSupporter` flag (delivered cross-device via the existing per-user,
 * RLS-protected `user_preferences` row — no new table, no migration).
 *
 * The accepted code(s) live in the `VITE_SUPPORTER_CODE` build env, NEVER
 * hard-coded here — fabricating a secret identifier in source would both leak
 * it in the bundle and violate the SEV1 "never invent external identifiers"
 * rule. Aaron sets the env when he starts issuing codes to sponsors; until then
 * the feature is simply unavailable (`isSupporterCodeConfigured()` is false and
 * the redeem UI stays hidden) rather than showing a dead input.
 *
 * Multiple codes are supported (comma-separated) so codes can be rotated or a
 * few issued in parallel. This is an honor-system unlock for cosmetic/export
 * perks, not a hardened licence check — appropriate to the low stakes and the
 * absence of a server-side validation endpoint on the web build.
 */

/**
 * Normalize a code for comparison: trim, strip all internal whitespace, and
 * uppercase. So `" lift-abc 123 "` and `"LIFTABC123"` compare equal — sponsors
 * paste codes with stray spaces/case and it should still work.
 */
export function normalizeSupporterCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

/** The configured accepted codes, normalized. Empty when none are set. */
function acceptedCodes(): string[] {
  const raw = (import.meta.env.VITE_SUPPORTER_CODE as string | undefined) ?? ''
  return raw
    .split(',')
    .map(normalizeSupporterCode)
    .filter((c) => c.length > 0)
}

/**
 * True when this build has at least one redemption code configured — the web
 * sponsor path is only offered when a code exists to redeem against.
 */
export function isSupporterCodeConfigured(): boolean {
  return acceptedCodes().length > 0
}

/**
 * Verify a user-entered sponsor code against the configured code(s). Returns
 * false for empty input or when no code is configured — so an unconfigured
 * build can never accidentally grant the entitlement.
 */
export function verifySupporterCode(input: string): boolean {
  const candidate = normalizeSupporterCode(input ?? '')
  if (!candidate) return false
  return acceptedCodes().includes(candidate)
}
