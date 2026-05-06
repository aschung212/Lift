// One-time script: trim non-default themes from index.css (now lazy-loaded)
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '..', 'src', 'index.css');
const eternalPath = resolve(__dirname, '..', 'src', 'themes', 'eternal.css');

const lines = readFileSync(cssPath, 'utf8').split('\n');
const eternal = readFileSync(eternalPath, 'utf8');

// Lines 1-645 (0-indexed 0-644) are theme tokens; line 646+ is type scale onward
const rest = lines.slice(645).join('\n');

const header = `/* --- Theme tokens ---------------------------------------------------------------- */
/* Non-default themes are lazy-loaded from src/themes/*.css via themeLoader.ts */
/* Eternal (default) is inlined here to prevent FOUC on first load */

`;

const output = header + eternal + '\n' + rest;
writeFileSync(cssPath, output);
console.log(`Done: ${lines.length} -> ${output.split('\n').length} lines`);
