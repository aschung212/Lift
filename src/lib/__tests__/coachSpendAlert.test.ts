import { describe, it, expect } from 'vitest'
import {
  SPEND_ALERT_FRACTION,
  spendAlertThresholdCents,
  buildSpendAlertText,
} from '../coachSpendAlert'

describe('coachSpendAlert', () => {
  describe('spendAlertThresholdCents', () => {
    it('is half the ceiling for the default $2/day ceiling', () => {
      expect(SPEND_ALERT_FRACTION).toBe(0.5)
      expect(spendAlertThresholdCents(200)).toBe(100)
    })

    it('floors odd ceilings to a whole cent', () => {
      expect(spendAlertThresholdCents(101)).toBe(50)
    })

    it('returns 0 for a non-positive or non-finite ceiling (alerting disabled)', () => {
      expect(spendAlertThresholdCents(0)).toBe(0)
      expect(spendAlertThresholdCents(-50)).toBe(0)
      expect(spendAlertThresholdCents(Number.NaN)).toBe(0)
    })
  })

  describe('buildSpendAlertText', () => {
    it('renders spend, ceiling, and percentage as dollars', () => {
      const msg = buildSpendAlertText(100, 200)
      expect(msg).toContain('$1.00')
      expect(msg).toContain('$2.00')
      expect(msg).toContain('50%')
    })

    it('names the auto-pause backstop so the reader knows no action is required yet', () => {
      expect(buildSpendAlertText(100, 200)).toContain('Auto-pauses at 100%')
    })

    it('reports 0% when the ceiling is non-positive rather than dividing by zero', () => {
      const msg = buildSpendAlertText(100, 0)
      expect(msg).toContain('0%')
      expect(msg).not.toContain('Infinity')
      expect(msg).not.toContain('NaN')
    })

    it('clamps negative/NaN spend to $0.00', () => {
      expect(buildSpendAlertText(-10, 200)).toContain('$0.00')
      expect(buildSpendAlertText(Number.NaN, 200)).toContain('$0.00')
    })
  })
})
