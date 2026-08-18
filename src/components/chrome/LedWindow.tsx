/**
 * The red LED window off the television's front panel, on its own.
 *
 * The editor console is not a television — there is no tube on `/edit` — but it
 * is the same appliance, and the page you are working on should be reported the
 * way the set reports the page you are watching: three seven-segment digits, a
 * point, and two more for the subpage, behind a tinted plate.
 *
 * Self-contained rather than borrowing the set's `<defs>`. The handset can share
 * them because it is only ever rendered beside the cabinet that defines them
 * (see the note in {@link CrtTelevision}); this window is rendered where there
 * is no cabinet at all, so it carries its own — under `led-` ids, which is also
 * what keeps the two sets from colliding should they ever meet on one page.
 *
 * The geometry is the handset's, unchanged, so the two windows are the same
 * window: 18,18 for the bezel, digits from 36,36 on a 34 pitch, the subpage pair
 * at 154,48 three-quarter size. The `viewBox` is that rectangle plus the
 * captions underneath.
 */

import { SevenSegment } from './SevenSegment';

export interface LedWindowProps {
  /** Three glyphs for the page window — digits, or `-` for a digit not yet dialled. */
  pageDigits: string;
  /** Two glyphs for the subpage window. */
  subDigits: string;
  /** Read out to a screen reader, which has no use for fourteen `<rect>`s. */
  label: string;
}

export function LedWindow({ pageDigits, subDigits, label }: LedWindowProps) {
  return (
    <svg
      className="rc-display-svg"
      viewBox="14 12 208 110"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id="led-win" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050505" />
          <stop offset="1" stopColor="#110807" />
        </linearGradient>
        <linearGradient id="led-gloss" x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".075" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".025" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* The plate over the LEDs: what made an unlit segment a shadow rather
            than a grey bar, on every set that had one. */}
        <linearGradient id="led-filter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a0605" stopOpacity=".22" />
          <stop offset="1" stopColor="#1c0302" stopOpacity=".30" />
        </linearGradient>
        <filter id="led-bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="b2" />
          <feMerge>
            <feMergeNode in="b1" />
            <feMergeNode in="b2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="led-clip">
          <rect x="20" y="20" width="196" height="76" rx="3" />
        </clipPath>
      </defs>

      <rect x="18" y="18" width="200" height="80" rx="4" fill="#000" />
      <rect x="20" y="20" width="196" height="76" rx="3" fill="url(#led-win)" />

      <g transform="translate(36 36) skewX(-5)">
        {[...pageDigits].map((glyph, index) => (
          <SevenSegment key={index} glyph={glyph} index={index} />
        ))}
      </g>
      <rect className="disp-dot" x="140" y="74" width="5" height="5" fill="#ff3b2c" />
      <g transform="translate(154 48) scale(.72) skewX(-5)">
        {[...subDigits].map((glyph, index) => (
          <SevenSegment key={index} glyph={glyph} index={index} />
        ))}
      </g>

      <rect
        x="20"
        y="20"
        width="196"
        height="76"
        rx="3"
        fill="url(#led-filter)"
        pointerEvents="none"
        style={{ mixBlendMode: 'multiply' }}
      />
      <path
        d="M22 22 H214 V50 Q130 66 22 42 Z"
        fill="url(#led-gloss)"
        pointerEvents="none"
        clipPath="url(#led-clip)"
      />

      <text className="cap" x="83" y="114" aria-hidden="true">
        PAGE
      </text>
      <text className="cap" x="168" y="114" aria-hidden="true">
        SUB
      </text>
    </svg>
  );
}

export default LedWindow;
