# In-App Purchases / Supporter tier (LIFT-598)

The app-side seam for App Store in-app purchases and the **Supporter** entitlement.
This is the foundation the monetization surfaces (tip jar, Supporter perks, share
watermark removal) build on. It ships **fail-closed**: until a native build is
provisioned with a RevenueCat key, everyone is on the free tier.

## Layers

- **`src/lib/nativePurchases.ts`** — the native bridge. Registers a Lift-owned
  `LiftPurchases` Capacitor plugin via `registerPlugin` (same pattern as
  `nativeAppIcon`), so the **web build has zero dependency on any purchase npm
  package**. Every call no-ops on web and swallows native errors.
- **`src/composables/usePurchases.ts`** — reactive orchestration. Owns the
  entitlement state and the `initializePurchases` / `purchaseSupporter` /
  `restoreSupporterPurchases` flows. `supporterEntitlement` is the single source
  of truth.
- **`src/composables/useSupporter.ts`** — the stable read-only accessor gated
  surfaces consume (today: the share-card "Made with Lift" watermark).
- **`src/composables/useAuth.ts`** — `initStores(userId)` calls
  `initializePurchases()` on sign-in, forwarding the Supabase user id.

## What's left: native provisioning (not done in the app repo)

1. Add the RevenueCat Capacitor plugin to the iOS project and implement the
   `LiftPurchases` plugin methods (`configure`, `getActiveEntitlements`,
   `purchaseProduct`, `restorePurchases`) by delegating to RevenueCat's StoreKit
   SDK. Map RevenueCat's active entitlements onto the `SUPPORTER_ENTITLEMENT`
   (`'supporter'`) identifier — it must match the entitlement configured in the
   RevenueCat dashboard.
2. Create the Supporter product in App Store Connect + RevenueCat and a matching
   offering.
3. Set `VITE_REVENUECAT_IOS_KEY` (the **publishable** RevenueCat iOS SDK key — a
   client key, safe to embed; **never** a secret/server key) in the build env.
   With no key set, `initializePurchases` no-ops and the free tier is preserved.
4. Wire a purchase/restore UI (Settings → Supporter) to `usePurchases`.

## Guardrails

- Never hardcode a RevenueCat key — read it from `VITE_REVENUECAT_IOS_KEY`.
- The entitlement fails closed: any error, cancel, or missing config → free tier.
- `restoreSupporterPurchases` is required by App Store guidelines for
  non-consumable IAP — keep it wired into any purchase UI.
- `resetPurchases()` runs on sign-out (`useAuth.resetStores`) so the entitlement
  never survives a user switch on a shared device.
- Pass the signed-in user id as `appUserId` to `initializePurchases` so
  RevenueCat associates entitlements with a stable identity across reinstalls.
