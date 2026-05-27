/**
 * Coverage ratchet — pure logic module.
 *
 * Compares current coverage metrics against a baseline and determines whether
 * coverage has regressed beyond the allowed margin. Optionally computes an
 * updated baseline when coverage improves.
 *
 * This module is intentionally side-effect-free (no file I/O or process.exit)
 * so it can be unit-tested.
 */

/** @type {readonly string[]} */
export const METRICS = /** @type {const} */ (['statements', 'branches', 'functions', 'lines']);

/**
 * @typedef {{ statements: number, branches: number, functions: number, lines: number }} CoverageBaseline
 * @typedef {{ total: Record<string, { pct: number }> }} CoverageSummary
 * @typedef {{ metric: string, baseline: number, current: number, delta: number, regressed: boolean, improved: boolean }} MetricResult
 * @typedef {{ results: MetricResult[], failed: boolean, updatedBaseline: CoverageBaseline | null }} RatchetResult
 */

/**
 * Compare current coverage against baseline.
 *
 * @param {CoverageSummary} summary   — parsed coverage-summary.json
 * @param {CoverageBaseline} baseline — parsed .coverage-baseline.json
 * @param {{ margin?: number, update?: boolean }} [opts]
 * @returns {RatchetResult}
 */
export function compareBaseline(summary, baseline, opts = {}) {
  const { margin = 0, update = false } = opts;

  const results = /** @type {MetricResult[]} */ ([]);
  let failed = false;
  const improved = /** @type {Record<string, number>} */ ({});

  for (const metric of METRICS) {
    const base = baseline[metric];
    const cur = summary.total[metric].pct;
    const delta = cur - base;
    const regressed = delta < -margin;
    const isImproved = delta > 0;

    results.push({ metric, baseline: base, current: cur, delta, regressed, improved: isImproved });

    if (regressed) failed = true;
    if (isImproved) improved[metric] = cur;
  }

  let updatedBaseline = null;
  if (update && Object.keys(improved).length > 0) {
    updatedBaseline = { ...baseline };
    for (const [metric, value] of Object.entries(improved)) {
      updatedBaseline[metric] = Number(value.toFixed(2));
    }
  }

  return { results, failed, updatedBaseline };
}

/**
 * Format ratchet results as a human-readable string for console output.
 *
 * @param {RatchetResult} result
 * @param {{ margin: number }} opts
 * @returns {string}
 */
export function formatResults(result, opts) {
  const lines = [];
  lines.push('Coverage ratchet check:');
  lines.push(`  Margin: ${opts.margin}%\n`);
  lines.push('  Metric       Baseline   Current    Delta');
  lines.push('  ──────────── ────────── ────────── ──────');

  for (const r of result.results) {
    const sign = r.delta >= 0 ? '+' : '';
    const status = r.regressed ? ' ✗ REGRESSION' : r.improved ? ' ↑ improved' : '';
    lines.push(
      `  ${r.metric.padEnd(12)} ${r.baseline.toFixed(2).padStart(8)}%  ${r.current.toFixed(2).padStart(8)}%  ${sign}${r.delta.toFixed(2)}%${status}`
    );
  }

  lines.push('');

  if (result.failed) {
    lines.push(
      `Coverage dropped below baseline (margin: ${opts.margin}%). ` +
      'Add tests to restore coverage before merging.'
    );
  } else if (result.updatedBaseline) {
    lines.push('Baseline ratcheted up. New values:');
    lines.push(JSON.stringify(result.updatedBaseline, null, 2));
  } else if (result.results.some(r => r.improved)) {
    lines.push('Coverage improved! Run with --update to ratchet up the baseline.');
  } else {
    lines.push('Coverage matches baseline. No changes needed.');
  }

  return lines.join('\n');
}
