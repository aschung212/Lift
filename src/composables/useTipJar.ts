/**
 * useTipJar — the tip-jar purchase state machine + analytics gate (LIFT-910).
 *
 * A tip is a one-time StoreKit *consumable*: it thanks the developer, it does
 * not unlock anything (that's the supporter entitlement, LIFT-598). This
 * composable owns:
 *
 *   - the reactive purchase status (idle → purchasing → thanks / error)
 *   - native gating (the jar only exists on the native build; on web there is no
 *     StoreKit and Apple forbids external purchase links in the wrapper anyway)
 *   - the conversion analytics (impression + attempt/completed/cancelled/failed)
 *     so the tip-jar-vs-subscription decision can be made from data
 *   - a device-local count of completed tips, used to show a warmer thank-you
 *
 * The native StoreKit bridge lives in `src/lib/tipJar.ts`; wiring it into the
 * native build depends on the Capacitor IAP setup (LIFT-598). Everything here is
 * platform-independent and fully tested against an injected purchase fn.
 */
import { ref, readonly, type Ref } from 'vue'
import { isNative } from '../lib/platform'
import { logError } from '../lib/logger'
import { useAnalytics } from './useAnalytics'
import {
  TIP_TIERS,
  purchaseTip as nativePurchaseTip,
  type TipTier,
  type TipTierId,
  type TipPurchaseStatus,
} from '../lib/tipJar'

/** UI state of the tip flow. */
export type TipStatus = 'idle' | 'purchasing' | 'thanks' | 'error'

const HISTORY_KEY = 'tip-jar-history'

interface TipHistory {
  /** Total completed tips on this device. */
  count: number
  /** Timestamp (ms) of the most recent completed tip. */
  lastAt: number
}

function loadHistory(): TipHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return { count: 0, lastAt: 0 }
    const parsed = JSON.parse(raw)
    const count = typeof parsed?.count === 'number' && parsed.count >= 0 ? Math.floor(parsed.count) : 0
    const lastAt = typeof parsed?.lastAt === 'number' && parsed.lastAt >= 0 ? parsed.lastAt : 0
    return { count, lastAt }
  } catch {
    return { count: 0, lastAt: 0 }
  }
}

function saveHistory(history: TipHistory): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch (e) {
    logError(e, { source: 'useTipJar.saveHistory' })
  }
}

// Module singletons so status + count are shared across every mounted consumer.
const _status = ref<TipStatus>('idle')
const _tipCount = ref(loadHistory().count)

export interface UseTipJarReturn {
  /** Whether the tip jar is offered at all (native build only). */
  available: boolean
  /** The tip tiers to render. */
  tiers: readonly TipTier[]
  /** Current flow status. */
  status: Readonly<Ref<TipStatus>>
  /** Number of completed tips recorded on this device. */
  tipCount: Readonly<Ref<number>>
  /** Fire the impression event once when the tip UI is first shown. */
  logImpression: () => void
  /** Attempt to purchase a tip tier; resolves to the terminal purchase status. */
  tip: (tierId: TipTierId) => Promise<TipPurchaseStatus>
  /** Return the flow to idle (e.g. after dismissing the thank-you). */
  reset: () => void
}

/**
 * @param purchaseFn injectable native bridge, defaulting to the real StoreKit
 *   wrapper. Tests pass a fake so the policy/analytics are exercised without a
 *   native bridge.
 */
export function useTipJar(
  purchaseFn: (productId: string) => Promise<{ status: TipPurchaseStatus }> = nativePurchaseTip,
): UseTipJarReturn {
  const { logEvent } = useAnalytics()

  function logImpression(): void {
    if (!isNative) return
    logEvent('tip_jar_impression', {})
  }

  async function tip(tierId: TipTierId): Promise<TipPurchaseStatus> {
    // No StoreKit off-native, and a second concurrent purchase would race the
    // status machine — bail without touching state.
    if (!isNative) return 'unavailable'
    if (_status.value === 'purchasing') return 'unavailable'

    const tier = TIP_TIERS.find(t => t.id === tierId)
    if (!tier) return 'unavailable'

    _status.value = 'purchasing'
    logEvent('tip_jar_purchase_attempt', { tier: tier.id, productId: tier.productId })

    let status: TipPurchaseStatus
    try {
      ;({ status } = await purchaseFn(tier.productId))
    } catch (e) {
      // The bridge is documented never to throw; treat a throw as an error
      // outcome rather than leaving the flow stuck on 'purchasing'.
      logError(e, { source: 'useTipJar.tip' })
      status = 'error'
    }

    if (status === 'completed') {
      const next: TipHistory = { count: loadHistory().count + 1, lastAt: Date.now() }
      saveHistory(next)
      _tipCount.value = next.count
      _status.value = 'thanks'
      logEvent('tip_jar_purchase_completed', { tier: tier.id, productId: tier.productId })
    } else if (status === 'cancelled') {
      _status.value = 'idle'
      logEvent('tip_jar_purchase_cancelled', { tier: tier.id, productId: tier.productId })
    } else {
      // 'error' | 'unavailable'
      _status.value = 'error'
      logEvent('tip_jar_purchase_failed', { tier: tier.id, productId: tier.productId, reason: status })
    }

    return status
  }

  function reset(): void {
    _status.value = 'idle'
  }

  return {
    available: isNative,
    tiers: TIP_TIERS,
    status: readonly(_status),
    tipCount: readonly(_tipCount),
    logImpression,
    tip,
    reset,
  }
}
