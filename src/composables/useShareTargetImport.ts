import { useCsvImport, type CsvImportSummary } from './useCsvImport'

/**
 * Client half of the PWA Web Share Target flow. The service worker
 * (share-target-sw.js) stashes a shared CSV in the Cache API and redirects to
 * /?share-target=csv; on launch the app calls `consumePendingShare` to read
 * that cached file, run it through the shared importer, and clear the inbox so
 * a reload never re-imports. Returns the import summary (or null when there is
 * nothing to import) so the caller can surface a toast.
 */
const SHARE_INBOX_CACHE = 'lift-share-inbox'
const SHARE_INBOX_KEY = '/__shared-csv'

export function useShareTargetImport() {
  const { importFromText } = useCsvImport()

  function hasPendingShare(): boolean {
    return new URLSearchParams(window.location.search).get('share-target') === 'csv'
  }

  function clearShareParam(): void {
    const url = new URL(window.location.href)
    url.searchParams.delete('share-target')
    window.history.replaceState({}, '', url.pathname + url.search)
  }

  async function consumePendingShare(): Promise<CsvImportSummary | null> {
    if (!hasPendingShare()) return null
    // Strip the param up front so a manual reload can't replay the import.
    clearShareParam()
    if (typeof caches === 'undefined') return null
    try {
      const cache = await caches.open(SHARE_INBOX_CACHE)
      const res = await cache.match(SHARE_INBOX_KEY)
      if (!res) return null
      const text = await res.text()
      await cache.delete(SHARE_INBOX_KEY)
      if (!text.trim()) return null
      return importFromText(text, 'share_target')
    } catch {
      return null
    }
  }

  return { hasPendingShare, consumePendingShare }
}
