#!/usr/bin/env node

/**
 * Production-bundle guard: fails if a dev-only UI surface shipped.
 *
 * Two surfaces exist only for local dev and the CI e2e build (VITE_E2E=true):
 *
 *   1. The dev sign-in bypass (LIFT-1123). AuthScreen renders a "Continue as
 *      Dev" button that calls devSignIn(), which fabricates a
 *      `{ id: 'local-dev' }` session and skips the entire auth gate. It lives
 *      in src/views/DevSignInButton.vue.
 *   2. The Settings dev tools (#1425): Seed XP, Reset Onboarding, Run
 *      Migration, Clear All Data. They live in src/views/DevToolsGroup.vue.
 *      Until #1425 they were an inline group behind a localhost/LAN hostname
 *      test, and the bundled Capacitor app — served from capacitor://localhost
 *      — rendered them on every native install, App Store build included.
 *
 * Both components are lazily imported by their host behind a build-time
 * `import.meta.env.DEV || import.meta.env.VITE_E2E === 'true'` gate, so a
 * normal production build folds the flag to false, tree-shakes the component
 * and never emits its chunk. The only things that could reintroduce one are a
 * misconfigured Vercel env var setting VITE_E2E, or the markup being inlined
 * into its host again (an inline `v-if` ships in every bundle, merely hidden).
 * This script greps the built `dist/` (which CI produces WITHOUT VITE_E2E) for
 * each surface's UI markers and fails the build if any are present.
 *
 * Run against a production build only (e.g. the build-and-test CI job). Running
 * it after `VITE_E2E=true npm run build` is expected to fail.
 *
 * Usage:
 *   node scripts/check-no-dev-surface.js
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

// UI markers unique to each surface. We deliberately do NOT grep for
// 'local-dev' / 'dev@localhost': those live in useAuth's devSignIn helper, which
// is part of the composable's returned API and therefore always present in the
// bundle regardless of the flag. A class + a label are what actually render
// each surface, and they are the strings that get tree-shaken out with it.
const SURFACES = [
  {
    name: 'dev sign-in bypass ("Continue as Dev")',
    markers: ['authDevBtn', 'Continue as Dev'],
    hint:
      'The "Continue as Dev" button must never ship to production. This usually ' +
      'means VITE_E2E was set for a production build, or the flag gate in ' +
      'AuthScreen.vue was removed. See LIFT-1123.',
  },
  {
    name: 'Settings dev tools (Seed XP / Clear All Data)',
    markers: ['devToolsGrid', 'Seed 80k XP'],
    hint:
      'The Dev Tools settings group must never ship to production — on the ' +
      'native build it renders for every user. This usually means VITE_E2E was ' +
      'set for a production build, the flag gate in SettingsSheet.vue was ' +
      'removed, or the group was inlined instead of lazily imported from ' +
      'DevToolsGroup.vue. See #1425.',
  },
];

if (!existsSync(distDir)) {
  console.error(
    `Error: ${distDir} not found. Run \`npm run build\` before this guard so ` +
      `there is a production bundle to inspect.`,
  );
  process.exit(1);
}

/** Recursively collect every emitted JS file under dist/ (chunks may be lazy). */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const jsFiles = collectJsFiles(distDir);

if (jsFiles.length === 0) {
  console.error(`Error: no .js files found under ${distDir} — is the build complete?`);
  process.exit(1);
}

let failed = false;
for (const surface of SURFACES) {
  const offenders = [];
  for (const file of jsFiles) {
    const contents = readFileSync(file, 'utf-8');
    const hits = surface.markers.filter((marker) => contents.includes(marker));
    if (hits.length > 0) {
      offenders.push({ file: file.replace(`${root}/`, ''), hits });
    }
  }
  if (offenders.length > 0) {
    failed = true;
    console.error(`❌ ${surface.name} leaked into the production bundle:`);
    for (const { file, hits } of offenders) {
      console.error(`   ${file} contains: ${hits.join(', ')}`);
    }
    console.error(`\n${surface.hint}\n`);
  }
}

if (failed) process.exit(1);

console.log(
  `✅ No dev-only UI in the production bundle (${SURFACES.length} surfaces, ` +
    `scanned ${jsFiles.length} JS files).`,
);
