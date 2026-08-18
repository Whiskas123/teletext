/**
 * The seven-segment digit, shared by every LED window in the app.
 *
 * Lifted out of {@link CrtTelevision} when the editor grew a display of its
 * own: the television's front panel, the handset under the phone layout and the
 * editor console all read out a page number the same way, and three copies of
 * the same fourteen rectangles is three chances for them to stop matching.
 *
 * The glyph is drawn in the artwork's own 26×44 cell with no transform of its
 * own, so a caller places it by translating the group it renders into — which is
 * how one component serves a 1000-unit cabinet and a 208-unit window without
 * knowing about either.
 *
 * `.seg.on` / `.seg.off` are left to CSS: the lit colour is the same everywhere
 * but the bloom filter is not, because a filter is referenced by id and each
 * window carries its own `<defs>`.
 */

/** Which of the seven segments each glyph lights. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

/** One digit's seven bars, in the artwork's own 26×44 cell. */
const SEGMENT_RECTS = [
  { seg: 'a', x: 3, y: 0, width: 20, height: 5 },
  { seg: 'b', x: 21, y: 3, width: 5, height: 18 },
  { seg: 'c', x: 21, y: 23, width: 5, height: 18 },
  { seg: 'd', x: 3, y: 39, width: 20, height: 5 },
  { seg: 'e', x: 0, y: 23, width: 5, height: 18 },
  { seg: 'f', x: 0, y: 3, width: 5, height: 18 },
  { seg: 'g', x: 3, y: 19.5, width: 20, height: 5 },
] as const;

/** Digits are 26 wide on a 34 pitch, so the gap between them is 8. */
const DIGIT_PITCH = 34;

export function SevenSegment({ glyph, index }: { glyph: string; index: number }) {
  const lit = SEGMENTS[glyph] ?? '';
  return (
    <g
      data-digit={index + 1}
      data-value={glyph}
      transform={index === 0 ? undefined : `translate(${index * DIGIT_PITCH} 0)`}
    >
      {SEGMENT_RECTS.map(({ seg, x, y, width, height }) => (
        <rect
          key={seg}
          data-seg={seg}
          className={`seg ${lit.includes(seg) ? 'on' : 'off'}`}
          x={x}
          y={y}
          width={width}
          height={height}
          rx={1}
        />
      ))}
    </g>
  );
}

export default SevenSegment;
