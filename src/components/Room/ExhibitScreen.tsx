/**
 * ExhibitScreen — the picture, and nothing else at all.
 *
 * Two boxes and a caption. The outer one is black and covers the display; the
 * inner one is the largest 4:3 rectangle that display will hold, and the page
 * is drawn into it. That is the whole component, and the shortness is the
 * point: every element that exists here is an element that could end up on a
 * CRT in a gallery, so there are three of them.
 *
 * ## Why 4:3, and why letterboxed
 *
 * The set this is going on is a real television, and a real television is 4:3.
 * A teletext page is 40 columns by 25 rows (24 of page and the fastext strip),
 * and both grids come out at exactly 4:3 when the cells are the oblongs
 * teletext cells actually were — so the page fills the tube without being
 * stretched or cropped, which is the one thing that must not happen to it.
 * Whatever the browser window's shape, the rectangle is fitted inside it and
 * the remainder is left black. On the CRT itself there is no remainder.
 *
 * The cells are then snapped to whole device pixels, for the reasons set out at
 * length against `.crt-raster .teletext-screen` in `App.css`: forty flexible
 * tracks dividing a fractional box put every cell edge on a half pixel, and the
 * antialiasing that follows shows up as a black mesh over the picture. Rounding
 * each cell down and centring what results costs under a cell in each direction
 * — against black, on a black tube.
 *
 * ## The dial readout
 *
 * A set being dialled showed `7--` while it waited for the rest of the number,
 * and without it there is no way to tell a keyboard that is being ignored from
 * a page that is slow. It sits in the bottom corner of the picture, inside the
 * frame rather than over the header — the header is the page's own, and a
 * number in it would read as the page having changed already — and it fades out
 * over the three seconds the half-dialled number has left to live. An idle
 * exhibition screen is therefore the page and nothing else, which is what it is
 * for.
 *
 * All of the behaviour is in {@link useExhibitMode}; this file draws what that
 * hook decided.
 */

import { type ReactNode } from 'react';

import type { ExhibitMode } from './useExhibitMode';

/*
 * Spread, not handed over whole.
 *
 * This took the `ExhibitMode` object as one prop and read the four fields it
 * needs off it in the markup, which is tidier to call and which the React
 * Compiler lint refuses: reaching a callback ref out of an object during render
 * is indistinguishable, to it, from reading `.current` off a ref object, so
 * every `mode.x` in the JSX came back as "cannot access refs during render".
 * Naming the fields as props costs one `{...mode}` at the call site and makes
 * the component's actual inputs legible, so it is not really a concession.
 */
export interface ExhibitScreenProps
  extends Pick<ExhibitMode, 'attachScreen' | 'fullscreen' | 'idle' | 'readout'> {
  /** The picture: a `<TeletextGrid>`. */
  children: ReactNode;
}

/**
 * Fill the display with one teletext page.
 *
 * The outer element is what gets handed to the Fullscreen API, so it carries
 * the hook's ref; it is a fixed full-viewport overlay in its own right, which
 * is what makes the fallback path — a browser that refuses fullscreen — look
 * the same as the granted one bar the browser's own chrome.
 */
export function ExhibitScreen({
  attachScreen,
  fullscreen,
  idle,
  readout,
  children,
}: ExhibitScreenProps) {
  return (
    <div
      className="exhibit"
      ref={attachScreen}
      data-idle={idle || undefined}
      data-fullscreen={fullscreen || undefined}
    >
      <div className="exhibit-picture">
        {children}
        {readout != null && (
          /*
           * Keyed by what it says, so each digit remounts the element and
           * restarts the fade from the top — the same restart the three-second
           * abandon timer gets, and for the same reason.
           */
          <div className="exhibit-dial" key={readout} aria-hidden="true">
            {readout}
          </div>
        )}
      </div>
    </div>
  );
}

export default ExhibitScreen;
