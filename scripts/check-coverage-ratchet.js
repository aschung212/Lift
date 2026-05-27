#!/usr/bin/env node

/**
 * Coverage ratchet CLI: prevents coverage from dropping below the committed baseline.
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
import { compareBaseline, formatResults } from './coverage-ratchet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const COVERAGE_SUMMARY = resolve(root, 'coverage/coverage-summary.json');
const BASELINE_FILE = resolve(root, '.coverage-baseline.json');

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

// Compare and report
const result = compareBaseline(summary, baseline, { margin, update: shouldUpdate });
console.log(formatResults(result, { margin }));

// Write updated baseline if ratcheted
if (result.updatedBaseline) {
  writeFileSync(BASELINE_FILE, JSON.stringify(result.updatedBaseline, null, 2) + '\n');
}

if (result.failed) {
  process.exit(1);
}
