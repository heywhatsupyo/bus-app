/**
 * Structural guards for the single-file app. These catch the failure modes that
 * unit tests on the logic cannot see: broken markup/script contracts, and CSS
 * that quietly defeats the browser.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INDEX_PATH, extractScript } from './load-app.js';

const html = readFileSync(INDEX_PATH, 'utf8');
const script = extractScript(html);
// Comments are stripped first: one of them quotes `[hidden] { display: none }`
// as prose, which would otherwise be matched as a real rule.
const css = (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Ids the script looks up, which must therefore exist in the markup. */
function referencedIds() {
  const ids = new Set();
  for (const m of script.matchAll(/(?:\bel|\binput)\('([A-Za-z]+)'\)/g)) ids.add(m[1]);
  for (const m of script.matchAll(/checkedValues\('([A-Za-z]+)'\)/g)) ids.add(m[1]);
  return ids;
}

function markupIds() {
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}

describe('DOM contract', () => {
  it('every id the script looks up exists in the markup', () => {
    // el() throws on a missing id, so a typo here breaks the page at boot.
    const missing = [...referencedIds()].filter((id) => !markupIds().has(id));
    expect(missing).toEqual([]);
  });

  it('looks up a meaningful number of ids', () => {
    // Guards against the regex silently matching nothing and passing vacuously.
    expect(referencedIds().size).toBeGreaterThan(10);
  });
});

describe('hidden elements actually hide', () => {
  // An author `display` outranks the browser's `[hidden] { display: none }`, so
  // without this guard `el.hidden = true` is a no-op on anything with a display
  // of its own. This is what kept the stop-search results open after picking.
  it('declares a [hidden] override', () => {
    const rule = /\[hidden\]\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'no [hidden] rule in the stylesheet').not.toBeNull();
    expect(rule[1].replace(/\s/g, '')).toContain('display:none!important');
  });

  it('hides every element the script toggles, despite their own display rules', () => {
    const toggled = new Set(
      [...script.matchAll(/el\('([A-Za-z]+)'\)\.hidden/g)].map((m) => m[1]),
    );
    expect(toggled.size).toBeGreaterThan(0);

    const guarded = /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/.test(css);
    for (const id of toggled) {
      const classes = new RegExp(`id="${id}"[^>]*class="([^"]+)"`).exec(html)?.[1] ?? '';
      for (const cls of classes.split(/\s+/).filter(Boolean)) {
        const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
        if (/\bdisplay\s*:/.test(rule)) {
          // Allowed only because the !important override wins.
          expect(guarded, `.${cls} sets display but nothing overrides [hidden]`).toBe(true);
        }
      }
    }
  });
});

describe('self-contained', () => {
  it('has exactly one inline style block and one inline script block', () => {
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('references no external stylesheet or script', () => {
    expect(/<link[^>]+rel="stylesheet"/.test(html)).toBe(false);
    expect(/<script[^>]+src=/.test(html)).toBe(false);
  });

  it('only reaches out to the two bus data hosts at runtime', () => {
    const hosts = new Set(
      [...script.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]),
    );
    expect([...hosts].sort()).toEqual(['arrivelah2.busrouter.sg', 'data.busrouter.sg']);
  });
});
