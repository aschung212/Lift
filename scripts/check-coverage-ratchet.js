#!/usr/bin/env node

/**
 * Coverage ratchet: prevents coverage from dropping below the committed baseline.
 *
 * Reads coverage-summary.json (produced by vitest --coverage) and compares it
 * against .coverage-baseline.json. Fails if any metric drops by more than
 * the allowed margin (default 0.5%, to absorb sub-percent jitter from test
 * ordering and flaky branch coverage). On CI with --update, writes a new
 * baseline when coverage improves — so the floor only ever ratchets up.
 *
 * Usage:
 *   node scripts/check-coverage-ratchet.js              # compare only
 *   node scripts/check-coverage-ratchet.js --update      # compare + ratchet up
 *   node scripts/check-coverage-ratchet.js --margin 2    # allow 2% drop
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const COVERAGE_SUMMARY = resolve(root, 'coverage/coverage-summary.json');
const BASELINE_FILE = resolve(root, '.coverage-baseline.json');
const METRICS = ['statements', 'branches', 'functions', 'lines'];

// Parse CLI args
const args = process.argv.slice(2);
const shouldUpdate = args.includes('--update');
const marginIdx = args.indexOf('--margin');
const margin = marginIdx !== -1 ? parseFloat(args[marginIdx + 1]) : 0.5;

if (Number.isNaN(margin)) {
  console.error('Error: --margin requires a numeric value');
  process.exit(1);
}

// Read files
let summary;
try {
  summary = JSON.parse(readFileSync(COVERAGE_SUMMARY, 'utf8'));
} catch {
  console.error(`Error: Could not read ${COVERAGE_SUMMARY}`);
  console.error('Run "npx vitest run --coverage" first.');
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
} catch {
  console.error(`Error: Could not read ${BASELINE_FILE}`);
  process.exit(1);
}

// Compare
const current = {};
for (const metric of METRICS) {
  current[metric] = summary.total[metric].pct;
}

let failed = false;
const improved = {};

console.log('Coverage ratchet check:');
console.log(`  Margin: ${margin}%\n`);
console.log('  Metric       Baseline   Current    Delta');
console.log('  ──────────── ────────── ────────── ──────');

for (const metric of METRICS) {
  const base = baseline[metric];
  const cur = current[metric];
  const delta = cur - base;
  const sign = delta >= 0 ? '+' : '';
  const status = delta < -margin ? ' ✗ REGRESSION' : delta > 0 ? ' ↑ improved' : '';

  console.log(
    `  ${metric.padEnd(12)} ${base.toFixed(2).padStart(8)}%  ${cur.toFixed(2).padStart(8)}%  ${sign}${delta.toFixed(2)}%${status}`
  );

  if (delta < -margin) {
    failed = true;
  }
  if (delta > 0) {
    improved[metric] = cur;
  }
}

console.log();

if (failed) {
  console.error(
    `Coverage dropped below baseline (margin: ${margin}%). ` +
    'Add tests to restore coverage before merging.'
  );
  process.exit(1);
}

// Ratchet up if any metric improved and --update was passed
if (shouldUpdate && Object.keys(improved).length > 0) {
  const newBaseline = { ...baseline };
  for (const [metric, value] of Object.entries(improved)) {
    // Round to 2 decimal places; toFixed avoids floating-point jitter
    // (e.g., 80.14 * 100 → 8013.999... which Math.floor would truncate)
    newBaseline[metric] = Number(value.toFixed(2));
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(newBaseline, null, 2) + '\n');
  console.log('Baseline ratcheted up. New values:');
  console.log(JSON.stringify(newBaseline, null, 2));
} else if (Object.keys(improved).length > 0) {
  console.log('Coverage improved! Run with --update to ratchet up the baseline.');
} else {
  console.log('Coverage matches baseline. No changes needed.');
}
