import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import type { BodyweightEntry } from '../../stores/bodyweight'

const downloadBlobMock = vi.fn()
const logEventMock = vi.fn()
let entries: BodyweightEntry[] = []

vi.mock('../../lib/dataExport', () => ({
  downloadBlob: (blob: Blob, filename: string) => downloadBlobMock(blob, filename),
}))

vi.mock('../useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: logEventMock }),
}))

vi.mock('../useWeightUnit', () => ({
  useWeightUnit: () => ({ weightUnit: ref('lbs') }),
}))

vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({ get entries() { return entries } }),
}))

import { useBodyweightExport } from '../useBodyweightExport'
import { todayISO } from '../../lib/dates'

function setNavigatorShare(share: ((data: ShareData) => Promise<void>) | undefined, canShare = true) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'canShare', {
    value: share ? () => canShare : undefined,
    configurable: true,
  })
}

describe('useBodyweightExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    entries = [{ id: 'a', weight: 180, date: '2026-08-01T23:59:00.000Z' }]
  })

  afterEach(() => {
    setNavigatorShare(undefined)
  })

  it('falls back to a download when Web Share is unavailable', async () => {
    setNavigatorShare(undefined)
    const { exportCsv } = useBodyweightExport()
    const result = await exportCsv()

    const filename = `lift-bodyweight-lbs-${todayISO()}.csv`
    expect(result).toEqual({ kind: 'downloaded', filename })
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), filename)
    expect(logEventMock).toHaveBeenCalledWith('bodyweight_export', { outcome: 'downloaded' })
  })

  it('shares the CSV as a file when Web Share supports files', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    setNavigatorShare(shareMock)
    const { exportCsv } = useBodyweightExport()
    const result = await exportCsv()

    expect(result).toEqual({ kind: 'shared' })
    expect(shareMock).toHaveBeenCalledTimes(1)
    const payload = shareMock.mock.calls[0][0] as ShareData
    expect(payload.files).toHaveLength(1)
    expect(payload.files![0].name).toBe(`lift-bodyweight-lbs-${todayISO()}.csv`)
    expect(payload.files![0].type).toBe('text/csv')
    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(logEventMock).toHaveBeenCalledWith('bodyweight_export', { outcome: 'shared' })
  })

  it('shares the CSV built from the store in the display unit', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    setNavigatorShare(shareMock)
    const { exportCsv } = useBodyweightExport()
    await exportCsv()

    const file = (shareMock.mock.calls[0][0] as ShareData).files![0]
    expect(await file.text()).toBe('Date,Weight\n2026-08-01,180')
  })

  it('treats a dismissed share sheet as a cancel, not a download', async () => {
    setNavigatorShare(vi.fn().mockRejectedValue(new DOMException('user dismissed', 'AbortError')))
    const { exportCsv } = useBodyweightExport()
    const result = await exportCsv()

    expect(result).toEqual({ kind: 'cancelled' })
    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(logEventMock).toHaveBeenCalledWith('bodyweight_export', { outcome: 'cancelled' })
  })

  it('falls through to the download when share fails unexpectedly', async () => {
    setNavigatorShare(vi.fn().mockRejectedValue(new Error('share broke')))
    const { exportCsv } = useBodyweightExport()
    const result = await exportCsv()

    expect(result.kind).toBe('downloaded')
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
  })

  it('skips Web Share when canShare rejects a file payload', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    setNavigatorShare(shareMock, false)
    const { exportCsv } = useBodyweightExport()
    const result = await exportCsv()

    expect(shareMock).not.toHaveBeenCalled()
    expect(result.kind).toBe('downloaded')
  })
})
