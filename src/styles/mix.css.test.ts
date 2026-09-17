/**
 * MIX is one rule in the cascade, so this is where it can break.
 *
 * A page held over the live picture is not a feature of the grid: the grid
 * renders identically either way, and the holes appear because
 * `.crt-tv[data-mix]` turns the cells coded black transparent (see `App.css`).
 * Nothing in a component test can see that — the markup is the same with mix on
 * and off — and the two ways it can silently stop working are both invisible in
 * review:
 *
 * - `.teletext-bg-black` in `styles/teletext.css` is loaded *after* `App.css`,
 *   so the override survives only on specificity. Give the black rule one more
 *   class and the picture goes back to being a black rectangle with no error
 *   anywhere.
 * - `.teletext-screen` paints its own black backdrop *over* the video, which is
 *   inside the raster with it. Transparent cells over an opaque screen show
 *   nothing at all, and it looks exactly like a camera that failed.
 *
 * So the real stylesheets go into jsdom and the questions are asked of the
 * computed style, which is the thing that actually decides.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const BLACK = 'rgb(0, 0, 0)';

// Read from the working directory rather than `import.meta.url`, for the reason
// given in `roomConsole.css.test.ts`: jsdom hands modules a non-`file:` URL.
// Both sheets, in the order `App.tsx` imports them — the order is half of what
// is being checked.
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = ['src/App.css', 'src/styles/teletext.css']
    .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
    .join('\n');
  document.head.append(style);
});

/** A television with a page on it, mixing or not. */
function set(mixing: boolean): HTMLElement {
  const tv = document.createElement('div');
  tv.className = 'crt-tv';
  tv.setAttribute('data-power', 'on');
  if (mixing) tv.setAttribute('data-mix', 'true');
  tv.innerHTML = `
    <div class="crt-glass">
      <div class="crt-raster">
        <video class="crt-signal"></video>
        <div class="teletext-screen" data-role="screen">
          <div class="teletext-grid">
            <div class="teletext-cell teletext-bg-black" data-role="black">x</div>
            <div class="teletext-cell teletext-bg-blue" data-role="blue">x</div>
            <div class="teletext-cell teletext-bg-black teletext-fg-white" data-role="index"> </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.append(tv);
  return tv;
}

function background(tv: HTMLElement, role: string): string {
  return getComputedStyle(tv.querySelector(`[data-role="${role}"]`)!).backgroundColor;
}

describe('mix mode', () => {
  it('holes the black cells through on a set that is mixing', () => {
    expect(background(set(true), 'black')).toBe(TRANSPARENT);
  });

  it('leaves them black on a set that is not', () => {
    expect(background(set(false), 'black')).toBe(BLACK);
  });

  it('takes the screen’s own backdrop with them, or the video is covered', () => {
    expect(background(set(true), 'screen')).toBe(TRANSPARENT);
    expect(background(set(false), 'screen')).toBe(BLACK);
  });

  it('touches only black: the other seven colours are the page, not a hole', () => {
    expect(background(set(true), 'blue')).toBe('rgb(0, 0, 255)');
  });

  it('holes the index line through as well, which a set did too', () => {
    expect(background(set(true), 'index')).toBe(TRANSPARENT);
  });

  it('leaves a grid outside a television alone — a thumbnail is not a tube', () => {
    const loose = document.createElement('div');
    loose.innerHTML = '<div class="teletext-cell teletext-bg-black" data-role="black"></div>';
    document.body.append(loose);
    expect(background(loose, 'black')).toBe(BLACK);
  });
});
