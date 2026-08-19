/**
 * A guard on the one control two pages share.
 *
 * `/about` borrows `.frontpage-lang` deliberately — one switch, one definition,
 * no second copy to keep in agreement (see `AboutPage.tsx`). The cost of sharing
 * a class is that a rule written for one page follows it to the other, and one
 * did: the phone breakpoint pinned the switch to the front page's corner with
 * `top: var(--frontpage-gutter-y); right: var(--frontpage-gutter)`, unscoped.
 *
 * On `/about` those custom properties are not declared — that page has its own
 * `--about-gutter*` — so both offsets were invalid at computed-value time and
 * resolved to `auto`. The button stayed absolutely positioned with nothing
 * telling it where to be, which puts it at the static position a flex container
 * hands an absolute child: the start corner of the header, directly over the
 * logo that goes home. On a phone the way back was under the language switch.
 *
 * Nothing about the markup was wrong, so no render test can see this. What sees
 * it is the stylesheet: a rule that reaches for a front-page variable has to say
 * it is a front-page rule.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolved from the working directory for the reason given in
// `roomConsole.css.test.ts`: jsdom hands modules a URL `fileURLToPath` refuses.
const CSS = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');

/** Every selector in the file, paired with the block it introduces. */
function rules(css: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const prevClose = css.lastIndexOf('}', brace);
    const prevOpen = css.lastIndexOf('{', brace - 1);
    const start = Math.max(prevClose, prevOpen) + 1;
    const selector = css
      .slice(Math.max(start, i), brace)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();

    let depth = 0;
    let j = brace;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    // An at-rule's braces hold more rules, so step inside rather than over.
    if (selector.startsWith('@')) {
      i = brace + 1;
      continue;
    }
    found.push({ selector, body: css.slice(brace + 1, j) });
    i = j + 1;
  }
  return found;
}

describe('the shared language switch', () => {
  const parsed = rules(CSS);
  const switchRules = parsed.filter((rule) =>
    /\.frontpage-lang(?![\w-])/.test(rule.selector),
  );

  it('is styled somewhere, so the checks below are checking something', () => {
    expect(switchRules.length).toBeGreaterThan(0);
  });

  it('never takes the front page a variable /about does not declare', () => {
    const trespassers = switchRules
      .filter(
        (rule) =>
          /var\(\s*--frontpage-/.test(rule.body) &&
          !/\.frontpage(?![\w-])/.test(rule.selector),
      )
      .map((rule) => rule.selector);

    expect(trespassers).toEqual([]);
  });

  it('is only taken out of the flow on the page that placed it', () => {
    // Absolute positioning is what turns a missing offset into "wherever the
    // flex container would have put me", which is on top of the back link.
    const floating = switchRules
      .filter(
        (rule) =>
          /position:\s*absolute|position:\s*fixed/.test(rule.body) &&
          !/\.frontpage(?![\w-])/.test(rule.selector),
      )
      .map((rule) => rule.selector);

    expect(floating).toEqual([]);
  });
});
