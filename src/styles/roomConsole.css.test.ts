/**
 * A guard against the bug that made the room's chat unusable twice in one pass.
 *
 * The chat and the roster were once panels in a plain sidebar, and their rules
 * were written unscoped: `.chat-form`, `.presence-rename-toggle` and the rest.
 * When they became consoles, `.room-console`-scoped rules were written over the
 * top — but the originals were still in the file, and two of their declarations
 * were not among the ones being overridden:
 *
 * - `.chat-form` was `flex-direction: column`, so the console's `flex: 1 1 6rem`
 *   on the field — a *width* to grow from, in the row it assumed — was read down
 *   the other axis and made the field six rems tall. A chat box the height of a
 *   paragraph, for one line of text.
 * - `.presence-rename-toggle` was `width: 100%`, so the compact key at the end of
 *   the roster's head stretched across the whole console and pushed the heading
 *   onto two lines.
 *
 * Neither is visible to a component test: the markup was correct throughout and
 * only the cascade was wrong. What catches it is the file itself — so this reads
 * the stylesheet and insists that the classes the console owns are not also
 * styled from outside it, which is the condition that made both bugs possible.
 *
 * The allowance below is for the rules that are genuinely shared and carry no
 * layout: a message's own typography, and the ellipsis on a long name.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolved from the working directory rather than from `import.meta.url`: the
// jsdom environment hands modules a URL that is not a `file:` one, and
// `fileURLToPath` refuses it. Vitest runs from the project root.
const CSS = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');

/**
 * Classes the room console lays out, and which nothing else may lay out.
 *
 * Matched as whole tokens, so `.chat-message` never stands in for
 * `.chat-messages`.
 */
const OWNED = [
  'chat-form',
  'chat-input',
  'chat-send',
  'chat-error',
  'chat-messages',
  'chat-empty',
  'presence-list',
  'presence-head',
  'presence-heading',
  'presence-members',
  'presence-member',
  'presence-swatch',
  'presence-empty',
  'presence-rename',
  'presence-rename-toggle',
  'presence-rename-btn',
  'presence-name-input',
  'presence-name-error',
];

/** Shared typography with no layout in it, allowed to stay unscoped. */
const SHARED = new Set([
  'presence-name',
  'chat-message',
  'chat-message-meta',
  'chat-message-author',
  'chat-message-time',
  'chat-message-text',
]);

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
    const selector = css.slice(Math.max(start, i), brace).trim();

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

describe('the room console owns its own layout', () => {
  const parsed = rules(CSS);

  it.each(OWNED)('nothing outside .room-console styles .%s', (name) => {
    const token = new RegExp(`\\.${name}(?![\\w-])`);
    const trespassers = parsed
      .filter(
        (rule) =>
          token.test(rule.selector) && !rule.selector.includes('room-console'),
      )
      .map((rule) => rule.selector);

    expect(trespassers).toEqual([]);
  });

  it('leaves the shared typography alone', () => {
    // The complement of the rule above: these *should* still be unscoped, so a
    // future cleanup that swept them up with the rest would be caught here.
    for (const name of SHARED) {
      const token = new RegExp(`\\.${name}(?![\\w-])`);
      expect(parsed.some((rule) => token.test(rule.selector))).toBe(true);
    }
  });
});
