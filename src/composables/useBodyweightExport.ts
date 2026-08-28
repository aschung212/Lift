/**
 * Share surface for the bodyweight Health-export CSV (#1159), built on
 * useShareFlow per the settled share-pipeline pattern (#880).
 *
 * One tier with an internal fallback, mirroring useWorkoutShare's file tier:
 * Web Share with the CSV as a File (iOS Safari 16.4+ — surfaces the system
 * sheet so the user can AirDrop, Save to Files, or hand the file straight to
 * a Health importer app), degrading to a plain browser download where file
 * sharing isn't available (desktop).
 */

import { type Ref } from 'vue'
import { useShareFlow, isShareCancellation, type ShareResult } from './useShareFlow'
import { useAnalytics } from './useAnalytics'
import { useWeightUnit } from './useWeightUnit'
import { useBodyweightStore } from '../stores/bodyweight'
import { buildBodyweightCsv, bodyweightCsvFilename } from '../lib/bodyweightExport'
import { downloadBlob } from '../lib/dataExport'
import { todayISO } from '../lib/dates'

/** Title shown in the share sheet above the attached CSV. */
const SHARE_TITLE = 'Lift bodyweight export'

export interface UseBodyweightExportReturn {
  exportCsv: () => Promise<ShareResult>
  isExporting: Ref<boolean>
  lastError: Ref<Error | null>
}

export function useBodyweightExport(): UseBodyweightExportReturn {
  const { isSharing, lastError, run } = useShareFlow()
  const { logEvent } = useAnalytics()
  const { weightUnit } = useWeightUnit()
  const store = useBodyweightStore()

  async function exportCsv(): Promise<ShareResult> {
    const result = await run([
      async () => {
        const unit = weightUnit.value
        const csv = buildBodyweightCsv(store.entries, unit)
        const filename = bodyweightCsvFilename(unit, todayISO())
        const file = new File([csv], filename, { type: 'text/csv' })

        if (
          typeof navigator !== 'undefined' &&
          !!navigator.share &&
          !!navigator.canShare?.({ files: [file] })
        ) {
          try {
            await navigator.share({ files: [file], title: SHARE_TITLE })
            return { kind: 'shared' as const }
          } catch (err) {
            // Cancel = user dismissed the sheet; anything else falls through
            // to the download so the data still gets out.
            if (isShareCancellation(err)) return { kind: 'cancelled' as const }
          }
        }

        downloadBlob(new Blob([csv], { type: 'text/csv' }), filename)
        return { kind: 'downloaded' as const, filename }
      },
    ])
    logEvent('bodyweight_export', { outcome: result.kind })
    return result
  }

  return { exportCsv, isExporting: isSharing, lastError }
}
