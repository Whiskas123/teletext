/**
 * SegmentVisor — several seven-segment readouts behind one piece of glass.
 *
 * {@link LedWindow} is the television's own window: a page and a subpage, at
 * fixed coordinates, because that is a real object with two numbers moulded into
 * it. The room's vote console needs three numbers — the page being asked for and
 * the count either side of it — and a fourth would not be surprising, so this
 * one is laid out rather than drawn: readouts left to right along the plate, all
 * of them standing on the same line whatever size they are drawn at, each with
 * its legend engraved underneath.
 *
 * The numbers it lays out with are the window's, so the two are visibly the same
 * instrument: digits in the shared 26×44 cell on a 34 pitch (see
 * {@link SevenSegment}), sixteen units of well either side of the row, the
 * second-and-later readouts at the three-quarter scale the set draws its subpage
 * at, and the same 5° lean on everything. The glass is literally the window's —
 * {@link LedPlate}, bezel, filter and gloss included.
 *
 * What is lit is entirely the caller's business: this component knows nothing
 * about votes, and an unlit readout is a string of spaces.
 */

import { LedPlate } from './LedWindow';
import { SevenSegment } from './SevenSegment';

/** The digit cell {@link SevenSegment} draws in, and the pitch it repeats at. */
const DIGIT_W = 26;
const DIGIT_H = 44;
const PITCH = 34;

/** Well edge to the first digit, and the space between one readout and the next. */
const PAD = 16;
const GAP = 27;

/** The scale the set draws its second window at, borrowed for the smaller ones. */
const SMALL = 0.72;

/** The plate's own box: everything is measured from here. */
const PLATE_X = 18;
const PLATE_Y = 18;
const PLATE_H = 80;
/** The line every readout stands on, tall or short. */
const BASELINE = 80;
/** Where the engraved legends sit, as on the window. */
const CAPTION_Y = 114;

export interface VisorReadout {
  /** One glyph per digit: `0`-`9`, `-`, or a space for a segment left dark. */
  digits: string;
  /** What is engraved into the panel under it. */
  caption: string;
  /** Drawn three-quarter size, as the set draws its subpage pair. */
  small?: boolean;
}

export interface SegmentVisorProps {
  /** The readouts, in the order they are read: left to right along the plate. */
  readouts: VisorReadout[];
  /** Read out to a screen reader, which has no use for a wall of `<rect>`s. */
  label: string;
  className?: string;
}

export function SegmentVisor({ readouts, label, className }: SegmentVisorProps) {
  /*
   * Placed in one pass so each readout knows where the one before it ended.
   *
   * A plain loop rather than a `map` closing over a running cursor: the compiler
   * cannot tell that a callback mutating a variable from the enclosing scope is
   * finished with it by the time the render is, so it refuses the reassignment.
   * The loop says the same thing without a callback to be suspicious of.
   */
  const placed: (VisorReadout & {
    x: number;
    width: number;
    scale: number;
    y: number;
  })[] = [];
  let cursor = PLATE_X + 2 + PAD;
  for (const readout of readouts) {
    const scale = readout.small ? SMALL : 1;
    const width = (DIGIT_W + (readout.digits.length - 1) * PITCH) * scale;
    placed.push({
      ...readout,
      x: cursor,
      width,
      scale,
      y: BASELINE - DIGIT_H * scale,
    });
    cursor += width + GAP;
  }

  // The last readout took a gap it had no successor for; the plate ends a
  // well's padding past its right edge instead.
  const plateW = cursor - GAP + PAD + 2 - PLATE_X;

  return (
    <svg
      className={className}
      viewBox={`${PLATE_X - 4} 12 ${plateW + 8} 110`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
    >
      <LedPlate x={PLATE_X} y={PLATE_Y} width={plateW} height={PLATE_H}>
        {placed.map(({ digits, x, y, scale }, index) => (
          <g key={index} transform={`translate(${x} ${y}) scale(${scale}) skewX(-5)`}>
            {[...digits].map((glyph, digit) => (
              <SevenSegment key={digit} glyph={glyph} index={digit} />
            ))}
          </g>
        ))}
      </LedPlate>

      {placed.map(({ caption, x, width }, index) => (
        <text key={index} className="cap" x={x + width / 2} y={CAPTION_Y} aria-hidden="true">
          {caption}
        </text>
      ))}
    </svg>
  );
}

export default SegmentVisor;
