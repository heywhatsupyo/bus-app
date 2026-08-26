/**
 * The app is a single self-contained index.html, so there is no module to
 * import. These tests pull the inline script straight out of the page and
 * evaluate it, which keeps index.html the one source of truth — no build step
 * and no second copy of the logic to drift.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const INDEX_PATH = join(here, '..', 'index.html');

/** Extract the inline `<script type="module">` body from the page. */
export function extractScript(html = readFileSync(INDEX_PATH, 'utf8')) {
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('No inline module script found in index.html');
  return match[1];
}

/**
 * Evaluate the page's script in Node and return everything it exposes on
 * `globalThis.LeaveNow`. There is no `document` here, so the page's
 * DOMContentLoaded hook is skipped by its own guard.
 */
export async function loadApp() {
  const code = extractScript();
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  await import(url);
  const api = /** @type {any} */ (globalThis).LeaveNow;
  if (!api) throw new Error('index.html did not expose globalThis.LeaveNow');
  return api;
}
