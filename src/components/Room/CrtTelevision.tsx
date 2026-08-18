/**
 * CrtTelevision — the set the teletext is watched on.
 *
 * The cabinet is a single inline SVG (a mid-80s Trinitron-style front panel,
 * see `assets/crt-teletext-frame.svg`) rather than the stack of gradient-filled
 * divs it replaces. Inline rather than an `<img>` because the panel is not
 * decoration: the keys are real buttons, the LED window is driven from state,
 * and the tube's reflections have to sit *over* the picture.
 *
 * The picture is a plain `<div>` *behind* the SVG, with the artwork's glass rect
 * left unfilled so the teletext shows through the hole. Everything the SVG draws
 * after that rect — reflections, dust, scratches, the shadow where the tube
 * meets the bezel — therefore lands on top of the picture without any of it
 * having to be interleaved, which is the ordering this set needs.
 *
 * It used to live in a `<foreignObject>` pinned to the glass, which reads better
 * and was wrong: WebKit rasterises a `foreignObject` subtree at scale 1 and
 * ignores the enclosing `viewBox` scale, so with the set drawn 960px wide on a
 * 1000-unit canvas Safari painted the picture 1/0.96 — four per cent oversized,
 * anchored at the glass's top-left and spilling across the bezel. Layout was
 * correct throughout; only the paint was wrong, so nothing *inside* the
 * `foreignObject` could correct it. Blink and Gecko were always right, which is
 * what made it look like a non-bug from every angle except Safari's.
 *
 * The cost of the hole is that the picture no longer lives in user-unit space,
 * so it cannot be sized in them. It is placed as a percentage of the set and
 * sized in `cqw` instead (see `.crt-glass` in `App.css`), which tracks the same
 * scale because the SVG's box *is* the container's box.
 *
 * ## Which keys do anything
 *
 * Every handler is optional and a key with no handler renders inert and
 * `aria-hidden` — moulded plastic, not a control. That is how the room and the
 * solo set differ: watching alone the keypad dials and the page keys step,
 * while in a room the page is the vote's to decide, so only the subpage keys
 * and the power button are live. See {@link RoomViewer} and {@link SoloViewer}.
 *
 * ## The phone build
 *
 * `compact` draws the same set with the cabinet cropped away — the artwork is
 * unchanged and only the `viewBox` moves, down to the bezel, the trim strip and
 * a few units of cabinet either side of them. Nothing is redrawn: the glass, the
 * mouldings and the wordmark keep the coordinates they were authored at, and the
 * picture follows because `.crt-glass` is placed as a fraction of whichever box
 * is on show (see `App.css`).
 *
 * The front panel does not survive the crop, so it is not rendered at all and
 * the same controls are laid out again at handset scale in {@link RemoteHandset},
 * which the set renders alongside itself for the phone layout to pin to the
 * bottom of the screen. Laid out again rather than cropped out and moved: a
 * strip lifted from the artwork comes out about ninety pixels tall on a phone,
 * with keys under twenty-five — below what a finger can reliably hit.
 *
 * ## Power
 *
 * The power button collapses the raster the way a CRT does: the picture
 * squashes to a bright horizontal line, the line pulls into a dot, and the dot
 * hangs on the phosphor for a moment after everything else has gone. Switching
 * on plays it backwards through a bloom and a settle. The animation is CSS (see
 * `.crt-*` in `App.css`); this component only sequences the four states and
 * skips straight to the destination under `prefers-reduced-motion`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { INDEX_LINE } from '../../domain/indexLine';
import { useMediaQuery } from '../../utils/useMediaQuery';

/** How long the switch-off animation runs, in step with `@keyframes crt-off-*`. */
const POWER_OFF_MS = 900;
/** How long the switch-on animation runs, in step with `@keyframes crt-on-*`. */
const POWER_ON_MS = 820;
/** A half-dialled page number is abandoned after this long, as a real set does. */
const DIAL_TIMEOUT_MS = 3000;
/** How long `---` shows after a page number that cannot exist. */
const DIAL_ERROR_MS = 700;

/** The four states of the tube: two settled, two mid-animation. */
type Power = 'on' | 'off' | 'powering-on' | 'powering-off';

export interface CrtTelevisionProps {
  /** The picture: a `<TeletextGrid>`, rendered onto the glass. */
  children: ReactNode;
  /** Page number shown in the LED window. */
  pageNumber: number;
  /** Subpage shown in the LED window, from 1. */
  subpage: number;
  /** How many screens the page holds. Only ever spoken, never displayed: the
   *  LED window has two digits and `1/3` needs three. */
  subpageCount: number;
  /**
   * Dial a page on the numeric keypad. Called once three digits are in.
   * Omit to leave the keypad inert.
   */
  onPageEntry?: (pageNumber: number) => void;
  /** Step to the next/previous page. Omit to leave the PAGE keys inert. */
  onPageStep?: (delta: 1 | -1) => void;
  /** Step through the carousel. Omit to leave the SUBPAGE keys inert. */
  onSubpageStep?: (delta: 1 | -1) => void;
  /** Jump to a fastext colour page. Omit to leave the colour keys inert. */
  onFastext?: (pageNumber: number) => void;
  /**
   * Draw the set cropped to its bezel, with the front panel moved out to a
   * remote control rendered after it. For the phone layout; see the note at the
   * top of this file.
   */
  compact?: boolean;
}

/* ── seven-segment LED window ──────────────────────────────────────────────── */

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

function SevenSegment({ glyph, index }: { glyph: string; index: number }) {
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

/* ── keys ──────────────────────────────────────────────────────────────────── */

interface PanelKeyProps {
  id: string;
  label: string;
  /** Absent means the key is moulded in but wired to nothing. */
  onPress?: () => void;
  /** The cap's box, which the hit area is grown out of. */
  hit: { x: number; y: number; width: number; height: number };
  /** Half the gap to the next cap; defaults to the front panel's. */
  pad?: number;
  children: ReactNode;
}

/**
 * How far past its cap, in user units, a key still counts as pressed.
 *
 * Three, because every gap on this panel is six: the keypad's pitch is 46 on a
 * 40-wide cap, the page and subpage pairs the same, and the fastext strip 57.5
 * on 51.5. Half a gap each side divides the dead space exactly, with no pair of
 * hit areas overlapping and nothing between two keys belonging to neither.
 *
 * The handset is laid out at its own scale with its own gaps, so it passes its
 * own half-gap in rather than taking this one — see {@link RemoteHandset}.
 */
const HIT_PADDING = 3;

/**
 * One key on the front panel.
 *
 * An SVG `<g>` rather than a `<button>` because a button cannot hold SVG
 * children and still lay out in user units, so the role, the tab stop and the
 * Enter/Space handling are supplied here. A key with no `onPress` drops all of
 * that and goes `aria-hidden`: a control that does nothing should not be
 * something a screen reader offers or a keyboard can land on.
 *
 * The invisible rect underneath is the hit area. These caps are 40 units wide on
 * a 1000-unit cabinet, so on a phone they land at about fifteen physical pixels
 * — under the size a finger can reliably hit. The gaps between them are dead
 * space that has to belong to somebody, and giving each key half of its own gap
 * costs nothing and buys back most of the difference.
 */
function PanelKey({ id, label, onPress, hit, pad = HIT_PADDING, children }: PanelKeyProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onPress?.();
    },
    [onPress],
  );

  if (onPress == null) {
    return (
      <g id={id} className="kb-inert" aria-hidden="true">
        {children}
      </g>
    );
  }

  return (
    <g
      id={id}
      className="kb"
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onPress}
      onKeyDown={handleKeyDown}
    >
      <rect
        className="kb-hit"
        x={hit.x - pad}
        y={hit.y - pad}
        width={hit.width + pad * 2}
        height={hit.height + pad * 2}
        fill="transparent"
      />
      {children}
    </g>
  );
}

/* ── the glass ─────────────────────────────────────────────────────────────── */

/**
 * What the tube's face does to the picture: reflections, dirt, and the shadow
 * the bezel casts onto it.
 *
 * Drawn into the picture rather than into the cabinet, because the picture is
 * no longer inside the cabinet's SVG (see the note at the top of this file) and
 * these have to land on top of the teletext to mean anything — a reflection
 * behind the picture is not a reflection.
 *
 * The `viewBox` is the glass's own rectangle in the artwork's coordinates, so
 * every shape below keeps the absolute numbers it was drawn with and stays
 * registered to the cabinet. `preserveAspectRatio` can stay at its default:
 * the element is the glass, and the glass is 4:3 like this box.
 *
 * The `url(#…)` references reach the `<defs>` in the cabinet's SVG. Ids are
 * scoped to the document, not to the element, so one set of gradients and
 * filters still serves both.
 */
function GlassSurface() {
  return (
    <svg className="crt-glass-surface" viewBox="180 80 640 480" aria-hidden="true">
      <g className="crt-reflections">
        <g clipPath="url(#clipScreen)">
          <rect x="180" y="80" width="640" height="480" fill="url(#glassTint)" />
          <rect x="180" y="80" width="640" height="480" fill="url(#glassVig)" />
          <rect x="180" y="80" width="640" height="480" fill="url(#glassHi)" />
          {/* reflected room: window panes, blurred, upper-left */}
          <g filter="url(#reflBlur)" opacity=".9">
            <path d="M215 92 L385 92 L330 250 L175 250 Z" fill="url(#reflWin)" opacity=".75" />
            <path d="M400 92 L470 92 L410 232 L345 232 Z" fill="url(#reflWin)" opacity=".55" />
          </g>
          {/* broad sweep across the tube face */}
          <rect x="180" y="80" width="640" height="480" fill="url(#reflSweep)" />
          {/* specular band on the top glass edge */}
          <rect x="180" y="80" width="640" height="480" fill="url(#glassEdge)" />
          {/* anti-glare coating speckle */}
          <rect
            x="180"
            y="80"
            width="640"
            height="480"
            filter="url(#antiGlare)"
            opacity=".05"
            style={{ mixBlendMode: 'screen' }}
          />
        </g>
        {/* directional cast from the bezel lip (light upper-left → shadow top/left) */}
        <g clipPath="url(#clipScreen)">
          <rect x="180" y="80" width="640" height="34" fill="url(#aoTop)" opacity=".5" />
          <rect x="180" y="80" width="26" height="480" fill="url(#aoLeft)" />
        </g>
        {/* glass imperfections: scratches, dust, a smudge near the corner */}
        <g clipPath="url(#clipScreen)">
          <rect
            x="180"
            y="80"
            width="640"
            height="480"
            filter="url(#scratches)"
            opacity=".10"
            transform="rotate(-11 500 320)"
          />
          <rect x="180" y="80" width="640" height="480" filter="url(#dust)" opacity=".16" />
          <ellipse
            cx="740"
            cy="500"
            rx="60"
            ry="30"
            filter="url(#smudge)"
            fill="url(#smudgeG)"
            opacity=".7"
            transform="rotate(-25 740 500)"
          />
          <ellipse
            cx="248"
            cy="530"
            rx="34"
            ry="14"
            filter="url(#smudge)"
            fill="url(#smudgeG)"
            opacity=".5"
            transform="rotate(15 248 530)"
          />
        </g>
      </g>

      {/* AO where the tube meets the bezel */}
      <g>
        <rect x="180" y="80" width="640" height="26" fill="url(#aoTop)" opacity=".55" />
        <rect x="180" y="534" width="640" height="26" fill="url(#aoBot)" opacity=".45" />
      </g>
    </svg>
  );
}

/* ── the remote ────────────────────────────────────────────────────────────── */

/**
 * The fastext keys, in the order the index line puts them.
 *
 * Taken from the grid's own `INDEX_LINE` rather than restated, because these
 * four keys *are* that line — a set's colour keys and the coloured words along
 * the bottom of the picture were always the same four destinations, and the two
 * drifting apart is the one way this can be wrong. Shared by the panel and the
 * handset, which are the same four keys twice.
 */
const FASTEXT_FILLS = ['#b7302a', '#2f8f43', '#c9a72a', '#2a8fae'] as const;

/**
 * The handset's canvas, in the same user units the cabinet is drawn in.
 *
 * Wider than it is tall by about two to one, so that spanning a phone it comes
 * out a little over half the height of the picture above it: enough for two rows
 * of keys a thumb can hit, and not so much that the set has nowhere to be.
 */
const REMOTE_W = 680;
const REMOTE_H = 356;

/** Half the gap between caps, in the handset's units — see {@link PanelKey}. */
const REMOTE_HIT_PADDING = 5;

/** The keypad, 5×2 as on the front panel: 1–5 over 6–0. */
const REMOTE_KEY_W = 112;
const REMOTE_KEY_H = 62;
const REMOTE_KEY_PITCH = 132;
const REMOTE_KEY_X0 = 20;
const REMOTE_KEY_ROWS = [136, 210] as const;
const REMOTE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/**
 * The fastext strip along the bottom, spanning the keypad's width.
 *
 * Slivers, as they were on every set that had them — four coloured bars, not
 * four more keys. `HIT` is what is actually pressed: half the gap either side as
 * everywhere else, and the strip's own height doubled into the blank panel above
 * and below it, which nothing else wants and a thumb badly needs.
 */
const REMOTE_FT_W = 145;
const REMOTE_FT_PITCH = 165;
const REMOTE_FT_Y = 296;
const REMOTE_FT_H = 32;
const REMOTE_FT_HIT_Y = 284;
const REMOTE_FT_HIT_H = 56;
const REMOTE_FT_HIT_PADDING = 10;

/** The rockers and the power key, in a row beside the LED window. */
const REMOTE_ROCKER_W = 76;
const REMOTE_ROCKER_H = 56;
const REMOTE_ROCKER_Y = 24;
const REMOTE_PAGE_X = [240, 326] as const;
const REMOTE_SUB_X = [419, 505] as const;
const REMOTE_POWER_X = 594;
const REMOTE_POWER_W = 66;

/**
 * What is pressed to work the power key, which is not quite its cap.
 *
 * The narrowest cap in the row, with the edge of the body on one side of it and
 * nothing but its own lamp below: it is given the slack around it rather than
 * left as the one key on the handset a thumb can miss.
 */
const REMOTE_POWER_HIT = { x: 591, y: 20, width: 73, height: 64 };

/**
 * One moulded cap at handset scale.
 *
 * The panel's caps are `<symbol>`s at four fixed sizes, which is right there —
 * they are the same four keys drawn ten times — and no use here, because a
 * `<symbol>` without a `viewBox` does not scale to the `<use>` that references
 * it. So the cap is drawn, from the same gradient and with the same moulding
 * highlight along its top edge.
 *
 * The highlight is `.lg` so that it travels with the cap when the key is pressed
 * (see `.kb:active` in `App.css`); a highlight that stayed put while its cap sank
 * would read as a line printed on the panel rather than as an edge of the key.
 */
function KeyCap({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="6"
        fill="url(#key)"
        stroke="#0a0a0a"
        filter="url(#castKey)"
      />
      <path
        className="lg"
        d={`M${x + 8} ${y + 3.6}H${x + width - 8}`}
        stroke="#9a9a94"
        strokeOpacity=".55"
        strokeWidth="1.8"
      />
    </>
  );
}

export interface RemoteHandsetProps {
  /** Three glyphs for the page window, already dialled or rolled. */
  pageDigits: string;
  /** Two glyphs for the subpage window. */
  subDigits: string;
  /** Whether the set is lit, which is what the lamp and the display report. */
  lit: boolean;
  subpage: number;
  subpageCount: number;
  /** One keypad digit. Omit to leave the keypad inert. */
  onDigit?: (digit: string) => void;
  onPageStep?: (delta: 1 | -1) => void;
  onSubpageStep?: (delta: 1 | -1) => void;
  onFastext?: (pageNumber: number) => void;
  onPower: () => void;
}

/**
 * The set's front panel, laid out again as something you hold.
 *
 * The same controls in the same order — LED window, page and subpage rockers,
 * power, keypad, fastext strip — out of the same gradients, mouldings and filters
 * as the cabinet, which is what makes it read as belonging to this television
 * rather than as a row of web buttons under a picture of one. Every `url(#…)`
 * below reaches the cabinet's `<defs>`; see the note there.
 *
 * Keys are more than twice the panel's, because this is the one that is actually
 * used by a thumb.
 */
function RemoteHandset({
  pageDigits,
  subDigits,
  lit,
  subpage,
  subpageCount,
  onDigit,
  onPageStep,
  onSubpageStep,
  onFastext,
  onPower,
}: RemoteHandsetProps) {
  return (
    <div className="crt-remote">
      <svg
        className="crt-remote-svg"
        viewBox={`0 0 ${REMOTE_W} ${REMOTE_H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label="Remote control"
      >
        {/* ===== BODY ===== */}
        <g id="remote-body">
          <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} rx="16" fill="url(#cab)" />
          <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} rx="16" fill="url(#cabSide)" />
          <g clipPath="url(#clipRemote)">
            <rect
              x="0"
              y="0"
              width={REMOTE_W}
              height={REMOTE_H}
              filter="url(#mould)"
              opacity=".07"
              style={{ mixBlendMode: 'overlay' }}
            />
            <rect
              x="0"
              y="0"
              width={REMOTE_W}
              height={REMOTE_H}
              filter="url(#grain)"
              opacity=".13"
              style={{ mixBlendMode: 'soft-light' }}
            />
          </g>
          <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} rx="16" fill="url(#keyLight)" />
          <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} rx="16" fill="url(#cabVig)" />
          <g clipPath="url(#clipRemote)">
            <rect x="0" y="0" width={REMOTE_W} height="8" fill="url(#chamTop)" />
            <rect x="0" y="0" width="8" height={REMOTE_H} fill="url(#chamLeft)" />
            <rect x="0" y={REMOTE_H - 14} width={REMOTE_W} height="14" fill="url(#chamBot)" />
            <rect x={REMOTE_W - 14} y="0" width="14" height={REMOTE_H} fill="url(#chamRight)" />
            {/* Held for twenty years by the same hand. */}
            <ellipse
              cx="330"
              cy="252"
              rx="66"
              ry="34"
              filter="url(#smudge)"
              fill="url(#smudgeG)"
              opacity=".4"
            />
            <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} filter="url(#dust)" opacity=".08" />
          </g>
        </g>

        {/* ===== LED WINDOW ===== */}
        <g id="remote-display">
          <rect x="18" y="18" width="200" height="80" rx="4" fill="#000" />
          <rect x="20" y="20" width="196" height="76" rx="3" fill="url(#win)" />
          <g transform="translate(36 36) skewX(-5)">
            {[...pageDigits].map((glyph, index) => (
              <SevenSegment key={index} glyph={glyph} index={index} />
            ))}
          </g>
          <rect
            className="disp-dot"
            x="140"
            y="74"
            width="5"
            height="5"
            fill="#ff3b2c"
            filter="url(#segGlow)"
            opacity={lit ? 1 : 0}
          />
          <g transform="translate(154 48) scale(.72) skewX(-5)">
            {[...subDigits].map((glyph, index) => (
              <SevenSegment key={index} glyph={glyph} index={index} />
            ))}
          </g>
          {/* red filter plate over the LEDs, as on the panel */}
          <rect
            x="20"
            y="20"
            width="196"
            height="76"
            rx="3"
            fill="url(#ledFilter)"
            pointerEvents="none"
            style={{ mixBlendMode: 'multiply' }}
          />
          <path
            d="M22 22 H214 V50 Q130 66 22 42 Z"
            fill="url(#winGloss)"
            pointerEvents="none"
            clipPath="url(#clipRemoteDisp)"
          />
          <text className="cap" x="83" y="112">
            PAGE
          </text>
          <text className="cap" x="168" y="112">
            SUB
          </text>
        </g>

        {/* ===== ROCKERS AND POWER ===== */}
        <g id="remote-page-nav">
          <PanelKey
            id="rc-page-down"
            label="Previous page"
            onPress={onPageStep == null ? undefined : () => onPageStep(-1)}
            hit={{ x: REMOTE_PAGE_X[0], y: REMOTE_ROCKER_Y, width: REMOTE_ROCKER_W, height: REMOTE_ROCKER_H }}
            pad={REMOTE_HIT_PADDING}
          >
            <KeyCap
              x={REMOTE_PAGE_X[0]}
              y={REMOTE_ROCKER_Y}
              width={REMOTE_ROCKER_W}
              height={REMOTE_ROCKER_H}
            />
            <path className="lg" d="M268 52 L286 42 L286 62 Z" fill="#dcdcda" />
          </PanelKey>
          <PanelKey
            id="rc-page-up"
            label="Next page"
            onPress={onPageStep == null ? undefined : () => onPageStep(1)}
            hit={{ x: REMOTE_PAGE_X[1], y: REMOTE_ROCKER_Y, width: REMOTE_ROCKER_W, height: REMOTE_ROCKER_H }}
            pad={REMOTE_HIT_PADDING}
          >
            <KeyCap
              x={REMOTE_PAGE_X[1]}
              y={REMOTE_ROCKER_Y}
              width={REMOTE_ROCKER_W}
              height={REMOTE_ROCKER_H}
            />
            <path className="lg" d="M374 52 L356 42 L356 62 Z" fill="#dcdcda" />
          </PanelKey>
          <text className="cap" x="321" y="112">
            PAGE
          </text>
        </g>

        <g id="remote-sub-nav">
          <PanelKey
            id="rc-sub-prev"
            label={`Previous subpage (showing ${subpage} of ${subpageCount})`}
            onPress={onSubpageStep == null ? undefined : () => onSubpageStep(-1)}
            hit={{ x: REMOTE_SUB_X[0], y: REMOTE_ROCKER_Y, width: REMOTE_ROCKER_W, height: REMOTE_ROCKER_H }}
            pad={REMOTE_HIT_PADDING}
          >
            <KeyCap
              x={REMOTE_SUB_X[0]}
              y={REMOTE_ROCKER_Y}
              width={REMOTE_ROCKER_W}
              height={REMOTE_ROCKER_H}
            />
            <path className="lg" d="M448 52 L464 43 L464 61 Z" fill="#dcdcda" />
          </PanelKey>
          <PanelKey
            id="rc-sub-next"
            label={`Next subpage (showing ${subpage} of ${subpageCount})`}
            onPress={onSubpageStep == null ? undefined : () => onSubpageStep(1)}
            hit={{ x: REMOTE_SUB_X[1], y: REMOTE_ROCKER_Y, width: REMOTE_ROCKER_W, height: REMOTE_ROCKER_H }}
            pad={REMOTE_HIT_PADDING}
          >
            <KeyCap
              x={REMOTE_SUB_X[1]}
              y={REMOTE_ROCKER_Y}
              width={REMOTE_ROCKER_W}
              height={REMOTE_ROCKER_H}
            />
            <path className="lg" d="M552 52 L536 43 L536 61 Z" fill="#dcdcda" />
          </PanelKey>
          <text className="cap" x="500" y="112">
            SUBPAGE
          </text>
        </g>

        {/*
          * Power, and the lamp under it.
          *
          * No legend on this one: the symbol is the legend, and the row it is in
          * has no width left for a fifth caption. The lamp takes the space the
          * caption would have had, which is where a set of the era put it.
          */}
        <g id="remote-power">
          <PanelKey
            id="rc-power"
            label={lit ? 'Switch the television off' : 'Switch the television on'}
            onPress={onPower}
            hit={REMOTE_POWER_HIT}
            pad={REMOTE_HIT_PADDING}
          >
            <KeyCap
              x={REMOTE_POWER_X}
              y={REMOTE_ROCKER_Y}
              width={REMOTE_POWER_W}
              height={REMOTE_ROCKER_H}
            />
            <circle
              className="lg"
              cx="627"
              cy="53"
              r="13"
              fill="none"
              stroke="#dcdcda"
              strokeWidth="3.2"
            />
            <line
              className="lg"
              x1="627"
              y1="36"
              x2="627"
              y2="53"
              stroke="#dcdcda"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          </PanelKey>
          <circle cx="627" cy="100" r="7.5" fill={lit ? 'url(#ledG)' : 'url(#ledR)'} />
          <circle cx="627" cy="100" r="11" fill="none" stroke="#000" strokeOpacity=".7" strokeWidth="1.6" />
        </g>

        {/* The strip that splits the display row from the keys, as on the set. */}
        <g id="remote-trim">
          <rect x="14" y="122" width={REMOTE_W - 28} height="6" fill="url(#alu)" />
          <rect
            x="14"
            y="122"
            width={REMOTE_W - 28}
            height="6"
            filter="url(#brush)"
            opacity=".35"
            style={{ mixBlendMode: 'multiply' }}
          />
          <rect x="14" y="122" width={REMOTE_W - 28} height="1.4" fill="#ffffff" opacity=".55" />
          <path d={`M14 128.5H${REMOTE_W - 14}`} stroke="#000" strokeOpacity=".85" />
        </g>

        {/* ===== KEYPAD ===== */}
        <g id="remote-keypad">
          {REMOTE_DIGITS.map((digit, index) => {
            const x = REMOTE_KEY_X0 + (index % 5) * REMOTE_KEY_PITCH;
            const y = REMOTE_KEY_ROWS[index < 5 ? 0 : 1];
            return (
              <PanelKey
                key={digit}
                id={`rc-key-${digit}`}
                label={`Dial ${digit}`}
                onPress={onDigit == null ? undefined : () => onDigit(digit)}
                hit={{ x, y, width: REMOTE_KEY_W, height: REMOTE_KEY_H }}
                pad={REMOTE_HIT_PADDING}
              >
                <KeyCap x={x} y={y} width={REMOTE_KEY_W} height={REMOTE_KEY_H} />
                <text className="lg" fill="#dcdcda" x={x + REMOTE_KEY_W / 2} y={y + 43}>
                  {digit}
                </text>
              </PanelKey>
            );
          })}
        </g>

        {/* ===== FASTEXT ===== */}
        <g id="remote-fastext">
          {INDEX_LINE.map((item, index) => {
            const x = REMOTE_KEY_X0 + index * REMOTE_FT_PITCH;
            return (
              <PanelKey
                key={item.fg}
                id={`rc-ft-${item.fg}`}
                label={`${item.label} (page ${item.page})`}
                onPress={onFastext == null ? undefined : () => onFastext(item.page)}
                hit={{ x, y: REMOTE_FT_HIT_Y, width: REMOTE_FT_W, height: REMOTE_FT_HIT_H }}
                pad={REMOTE_FT_HIT_PADDING}
              >
                <rect
                  x={x}
                  y={REMOTE_FT_Y}
                  width={REMOTE_FT_W}
                  height={REMOTE_FT_H}
                  rx="4"
                  fill={FASTEXT_FILLS[index]}
                  stroke="#0a0a0a"
                  filter="url(#castKey)"
                />
                <rect
                  x={x}
                  y={REMOTE_FT_Y}
                  width={REMOTE_FT_W}
                  height={REMOTE_FT_H}
                  rx="4"
                  fill="url(#ftkey)"
                />
              </PanelKey>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* ── the set ───────────────────────────────────────────────────────────────── */

/** Lowest and highest Page_Number a keypad entry can name. */
const MIN_DIALLED_PAGE = 100;
const MAX_DIALLED_PAGE = 999;

/**
 * The numeric keypad, laid out 5×2 as on the artwork.
 *
 * `hitY`/`hitH` are the top row's alone: there is nine units of blank panel
 * above it before the recess starts, and unclaimed panel next to a key that is
 * already too small for a finger is worth more as hit area than as margin. The
 * bottom row has the fastext strip under it and nowhere to grow.
 */
const KEYPAD = [
  { digit: '1', x: 380, y: 641, hitY: 632, hitH: 45 },
  { digit: '2', x: 426, y: 641, hitY: 632, hitH: 45 },
  { digit: '3', x: 472, y: 641, hitY: 632, hitH: 45 },
  { digit: '4', x: 518, y: 641, hitY: 632, hitH: 45 },
  { digit: '5', x: 564, y: 641, hitY: 632, hitH: 45 },
  { digit: '6', x: 380, y: 685, hitY: 685, hitH: 36 },
  { digit: '7', x: 426, y: 685, hitY: 685, hitH: 36 },
  { digit: '8', x: 472, y: 685, hitY: 685, hitH: 36 },
  { digit: '9', x: 518, y: 685, hitY: 685, hitH: 36 },
  { digit: '0', x: 564, y: 685, hitY: 685, hitH: 36 },
] as const;

/** Where the panel's fastext strip sits and how wide its keys are. */
const FASTEXT_KEY_WIDTH = 51.5;
const FASTEXT_KEY_PITCH = 57.5;
const FASTEXT_X0 = 380;

export function CrtTelevision({
  children,
  pageNumber,
  subpage,
  subpageCount,
  onPageEntry,
  onPageStep,
  onSubpageStep,
  onFastext,
  compact = false,
}: CrtTelevisionProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [power, setPower] = useState<Power>('on');
  const [dial, setDial] = useState('');
  const [dialError, setDialError] = useState(false);
  const powerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Powered for everything except a tube that has finished collapsing: the
  // switch-off animation is still showing a picture, so the panel stays lit
  // through it and only goes dark when the dot does.
  const lit = power !== 'off';

  // A press mid-collapse or mid-bloom is dropped rather than reversed: a real
  // set's relay can't be flipped again until it's finished throwing, and
  // reversing partway would jump-cut between two half-finished animations
  // instead of ever showing either one complete.
  const togglePower = useCallback(() => {
    if (power === 'powering-on' || power === 'powering-off') return;
    clearTimeout(powerTimer.current);
    setDial('');
    setDialError(false);
    const goingOff = power === 'on';
    if (reduceMotion) {
      setPower(goingOff ? 'off' : 'on');
      return;
    }
    powerTimer.current = setTimeout(
      () => setPower(goingOff ? 'off' : 'on'),
      goingOff ? POWER_OFF_MS : POWER_ON_MS,
    );
    setPower(goingOff ? 'powering-off' : 'powering-on');
  }, [power, reduceMotion]);

  useEffect(() => () => clearTimeout(powerTimer.current), []);

  // A page half dialled and then abandoned should not sit on the display
  // waiting forever — nor should it still be there to be completed by a digit
  // pressed minutes later, which would go somewhere nobody asked for.
  useEffect(() => {
    if (dial === '') return;
    const timer = setTimeout(() => setDial(''), DIAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [dial]);

  useEffect(() => {
    if (!dialError) return;
    const timer = setTimeout(() => setDialError(false), DIAL_ERROR_MS);
    return () => clearTimeout(timer);
  }, [dialError]);

  const pressDigit = useCallback(
    (digit: string) => {
      const next = dial + digit;
      if (next.length < 3) {
        setDial(next);
        return;
      }
      setDial('');
      const target = Number(next);
      // Only 100–999 name a page. A set given 0xx simply refused it, which is
      // more honest than silently rounding the entry up to something valid.
      if (target < MIN_DIALLED_PAGE || target > MAX_DIALLED_PAGE) {
        setDialError(true);
        return;
      }
      onPageEntry?.(target);
    },
    [dial, onPageEntry],
  );

  // A dead set stays dead. Dropping the handler rather than ignoring the press
  // is what makes the key go inert and `aria-hidden` (see `PanelKey`), which is
  // the truth of it: on an unplugged television these are pieces of plastic.
  // Power is deliberately not gated — otherwise there would be no way back.
  const digitPress = lit ? (onPageEntry != null ? pressDigit : undefined) : undefined;
  const pageStep = lit ? onPageStep : undefined;
  const subpageStep = lit ? onSubpageStep : undefined;
  const fastext = lit ? onFastext : undefined;

  // What the LED window reads. A dial in progress shows the digits so far and a
  // dash for each still to come (`2--`), which is what told you the set had
  // heard the first press and was waiting for the rest.
  const pageDigits = !lit
    ? '   '
    : dialError
      ? '---'
      : dial !== ''
        ? dial.padEnd(3, '-')
        : String(pageNumber).padStart(3, '0').slice(-3);
  const subDigits = !lit ? '  ' : String(subpage).padStart(2, '0').slice(-2);

  /*
   * The whole set, or the bezel and the trim strip with a few units of cabinet
   * showing round them. Same artwork either way — see the note at the top of
   * this file — so the second box is the first one with the cabinet's margins
   * taken off, and `.crt-glass` is placed against whichever is in force.
   */
  const viewBox = compact ? '146 46 708 566' : '0 0 1000 830';

  return (
    <>
      <div className="crt-tv" data-power={power} data-compact={compact || undefined}>
        <svg
          className="crt-tv-svg"
          viewBox={viewBox}
          xmlns="http://www.w3.org/2000/svg"
          role="group"
          aria-label="Television set"
        >
          <defs>
            <linearGradient id="cab" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a3937" />
              <stop offset=".12" stopColor="#2f2e2c" />
              <stop offset=".85" stopColor="#242321" />
              <stop offset="1" stopColor="#1a1918" />
            </linearGradient>
            <linearGradient id="cabSide" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".07" />
              <stop offset=".08" stopColor="#ffffff" stopOpacity="0" />
              <stop offset=".92" stopColor="#000000" stopOpacity="0" />
              <stop offset="1" stopColor="#000000" stopOpacity=".28" />
            </linearGradient>
            <linearGradient id="lip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4b4a48" />
              <stop offset=".5" stopColor="#3a3937" />
              <stop offset="1" stopColor="#26252a" />
            </linearGradient>
            <linearGradient id="bezelIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0d0d0e" />
              <stop offset="1" stopColor="#171718" />
            </linearGradient>
            <linearGradient id="glassBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1e2224" />
              <stop offset=".5" stopColor="#171a1c" />
              <stop offset="1" stopColor="#101314" />
            </linearGradient>
            <radialGradient id="glassHi" cx=".28" cy=".2" r=".9">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".05" />
              <stop offset=".45" stopColor="#ffffff" stopOpacity=".012" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="glassVig" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#000" stopOpacity=".18" />
              <stop offset=".12" stopColor="#000" stopOpacity="0" />
              <stop offset=".88" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity=".22" />
            </linearGradient>
            <linearGradient id="alu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e6e8ea" />
              <stop offset=".3" stopColor="#b9bdc0" />
              <stop offset=".55" stopColor="#d9dcde" />
              <stop offset=".8" stopColor="#8f9396" />
              <stop offset="1" stopColor="#5f6366" />
            </linearGradient>
            <linearGradient id="key" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a4947" />
              <stop offset=".08" stopColor="#3b3a38" />
              <stop offset=".9" stopColor="#2a2927" />
              <stop offset="1" stopColor="#1e1d1c" />
            </linearGradient>
            <linearGradient id="win" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#050505" />
              <stop offset="1" stopColor="#110807" />
            </linearGradient>
            <linearGradient id="winGloss" x1="0" y1="0" x2="0.15" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".075" />
              <stop offset=".55" stopColor="#fff" stopOpacity=".025" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="ledG" cx=".5" cy=".45" r=".55">
              <stop offset="0" stopColor="#b6ff9c" />
              <stop offset=".45" stopColor="#3ddc4c" />
              <stop offset="1" stopColor="#0d5a1c" />
            </radialGradient>
            {/* Standby: the same lamp driven the other way, as every set of the era did. */}
            <radialGradient id="ledR" cx=".5" cy=".45" r=".55">
              <stop offset="0" stopColor="#ff9b8a" />
              <stop offset=".45" stopColor="#d8321f" />
              <stop offset="1" stopColor="#4a0d06" />
            </radialGradient>
            <linearGradient id="ftkey" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".22" />
              <stop offset=".25" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity=".30" />
            </linearGradient>

            <filter id="grain" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".85"
                numOctaves="2"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id="brush" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".002 .9"
                numOctaves="1"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id="floorShadow" x="-30%" y="-100%" width="160%" height="300%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <filter id="glassIn" x="-10%" y="-10%" width="120%" height="120%">
              <feOffset dy="4" />
              <feGaussianBlur stdDeviation="9" result="b" />
              <feComposite operator="out" in="SourceGraphic" in2="b" result="i" />
              <feFlood floodColor="#000" floodOpacity=".85" />
              <feComposite operator="in" in2="i" result="s" />
              <feComposite operator="over" in="s" in2="SourceGraphic" />
            </filter>
            <filter id="segGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.6" result="g" />
              <feMerge>
                <feMergeNode in="g" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* key caps: small, tightly bevelled, like real 80s membrane/plastic keys */}
            <symbol id="k34">
              <rect x=".5" y=".5" width="33" height="25" rx="2.5" fill="url(#key)" stroke="#0a0a0a" />
              <path d="M3 1.8H31" stroke="#9a9a94" strokeOpacity=".55" strokeWidth="1" />
            </symbol>
            <symbol id="k40x36">
              <rect x=".5" y=".5" width="39" height="35" rx="3" fill="url(#key)" stroke="#0a0a0a" />
              <path d="M3 1.8H37" stroke="#9a9a94" strokeOpacity=".55" />
            </symbol>
            <symbol id="k52x34">
              <rect x=".5" y=".5" width="51" height="33" rx="3" fill="url(#key)" stroke="#0a0a0a" />
              <path d="M3 1.8H49" stroke="#9a9a94" strokeOpacity=".55" />
            </symbol>
            <symbol id="k40x26">
              <rect x=".5" y=".5" width="39" height="25" rx="2.5" fill="url(#key)" stroke="#0a0a0a" />
              <path d="M3 1.8H37" stroke="#9a9a94" strokeOpacity=".55" />
            </symbol>

            {/* ===== realism layer ===== */}
            {/* key light: soft window from upper-left, falloff to lower-right */}
            <linearGradient id="keyLight" x1="0.05" y1="0" x2="0.95" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".045" />
              <stop offset=".28" stopColor="#ffffff" stopOpacity=".012" />
              <stop offset=".62" stopColor="#000000" stopOpacity=".07" />
              <stop offset="1" stopColor="#000000" stopOpacity=".20" />
            </linearGradient>
            {/* broad diffuse bounce on the lower cabinet (light off the table) */}
            <linearGradient id="bounce" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#8fa2b5" stopOpacity=".10" />
              <stop offset=".18" stopColor="#8fa2b5" stopOpacity="0" />
            </linearGradient>
            {/* corner darkening so the box reads as a volume, not a flat card */}
            <radialGradient id="cabVig" cx=".38" cy=".3" r=".95">
              <stop offset=".45" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity=".38" />
            </radialGradient>
            {/* chamfer strips: moulded edges catch light on top, occlude at bottom */}
            <linearGradient id="chamTop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7d7c78" stopOpacity=".55" />
              <stop offset="1" stopColor="#7d7c78" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chamLeft" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6e6d69" stopOpacity=".38" />
              <stop offset="1" stopColor="#6e6d69" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chamBot" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity=".55" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chamRight" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity=".42" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            {/* ambient occlusion pooling around the tube opening */}
            <linearGradient id="aoTop" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#000" stopOpacity=".5" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="aoBot" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity=".42" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="aoLeft" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#000" stopOpacity=".45" />
              <stop offset="1" stopColor="#000" stopOpacity="0" />
            </linearGradient>
            {/* CRT glass: faint green-grey cast of real leaded tube glass */}
            <linearGradient id="glassTint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7f9a8d" stopOpacity=".07" />
              <stop offset="1" stopColor="#5d7480" stopOpacity=".05" />
            </linearGradient>
            {/* the room reflected in the tube: soft window shape, upper-left */}
            <linearGradient id="reflWin" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".16" />
              <stop offset=".55" stopColor="#ffffff" stopOpacity=".05" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="reflSweep" x1="0" y1="0" x2="1" y2="0.55">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <stop offset=".38" stopColor="#ffffff" stopOpacity=".045" />
              <stop offset=".55" stopColor="#ffffff" stopOpacity=".012" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            {/* specular band along the very top of the curved glass edge */}
            <linearGradient id="glassEdge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#dfe8ea" stopOpacity=".22" />
              <stop offset=".035" stopColor="#dfe8ea" stopOpacity=".04" />
              <stop offset=".09" stopColor="#dfe8ea" stopOpacity="0" />
            </linearGradient>
            <filter id="reflBlur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <filter id="softBlur" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            {/* coarse mould texture, larger scale than the fine grain */}
            <filter id="mould" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".012"
                numOctaves="3"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <filter id="antiGlare" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="1.6"
                numOctaves="1"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <clipPath id="clipScreen">
              <rect x="180" y="80" width="640" height="480" rx="6" />
            </clipPath>
            <clipPath id="clipCab">
              <rect x="90" y="30" width="820" height="750" rx="9" />
            </clipPath>

            {/* ===== imperfections & directional shadows ===== */}
            {/* sparse micro-scratches: high-frequency noise thresholded to hairlines */}
            <filter id="scratches" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".9 .02"
                numOctaves="1"
                seed="7"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA
                  type="discrete"
                  tableValues="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1"
                />
              </feComponentTransfer>
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"
              />
            </filter>
            {/* dust: sparse specks */}
            <filter id="dust" x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="2.4"
                numOctaves="1"
                seed="3"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA
                  type="discrete"
                  tableValues="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1"
                />
              </feComponentTransfer>
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"
              />
            </filter>
            {/* fingerprint / smudge: soft radial, blurred */}
            <radialGradient id="smudgeG" cx=".5" cy=".5" r=".5">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".055" />
              <stop offset=".6" stopColor="#ffffff" stopOpacity=".02" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <filter id="smudge" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            {/* directional cast shadow, upper-left key light */}
            <filter id="castKey" x="-30%" y="-30%" width="160%" height="180%">
              <feDropShadow
                dx="1.2"
                dy="2.2"
                stdDeviation="1.4"
                floodColor="#000"
                floodOpacity=".75"
              />
            </filter>
            <filter id="castTrim" x="-5%" y="-50%" width="110%" height="300%">
              <feDropShadow
                dx="0"
                dy="3"
                stdDeviation="2.5"
                floodColor="#000"
                floodOpacity=".6"
              />
            </filter>
            {/* LED display: tinted red filter window + strong bloom */}
            <linearGradient id="ledFilter" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a0605" stopOpacity=".22" />
              <stop offset="1" stopColor="#1c0302" stopOpacity=".30" />
            </linearGradient>
            <filter id="segBloom" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3.2" result="b1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="b2" />
              <feMerge>
                <feMergeNode in="b1" />
                <feMergeNode in="b2" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* fresnel rim on edges facing away from key light */}
            <linearGradient id="rimR" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="#b8c4cf" stopOpacity=".22" />
              <stop offset=".25" stopColor="#b8c4cf" stopOpacity=".04" />
              <stop offset="1" stopColor="#b8c4cf" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rimB" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#b8c4cf" stopOpacity=".16" />
              <stop offset=".3" stopColor="#b8c4cf" stopOpacity=".03" />
              <stop offset="1" stopColor="#b8c4cf" stopOpacity="0" />
            </linearGradient>
            {/* key wear: most-used keys have a slightly polished, lighter cap */}
            <radialGradient id="wear" cx=".5" cy=".55" r=".6">
              <stop offset="0" stopColor="#ffffff" stopOpacity=".09" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <clipPath id="clipPanel">
              <rect x="164" y="606" width="672" height="150" rx="3" />
            </clipPath>
            <clipPath id="clipDisp">
              <rect x="182" y="643" width="180" height="76" rx="2" />
            </clipPath>

            {/* The handset's two, kept here with the rest: ids are scoped to the
                document rather than to an `<svg>`, so everything above serves the
                remote as well, and it is only ever rendered beside this set.
                `clipPathUnits` defaults to the *referencing* element's user space,
                which is why these are in the handset's coordinates and not in the
                cabinet's. */}
            <clipPath id="clipRemote">
              <rect x="0" y="0" width={REMOTE_W} height={REMOTE_H} rx="16" />
            </clipPath>
            <clipPath id="clipRemoteDisp">
              <rect x="20" y="20" width="196" height="76" rx="3" />
            </clipPath>
          </defs>

          {/* The set as a piece of furniture: the shadow it throws on the
              table it stands on. Nothing to stand on in the phone build. */}
          {!compact && (
            <>
              {/* wide ambient + tight dark contact line */}
              <ellipse
                cx="500"
                cy="790"
                rx="410"
                ry="26"
                fill="#000"
                opacity=".34"
                filter="url(#floorShadow)"
              />
              <ellipse
                cx="500"
                cy="781"
                rx="330"
                ry="10"
                fill="#000"
                opacity=".55"
                filter="url(#softBlur)"
              />
            </>
          )}

          {/* ===== CABINET ===== */}
          <g id="cabinet">
            <rect x="90" y="30" width="820" height="750" rx="9" fill="url(#cab)" />
            <rect x="90" y="30" width="820" height="750" rx="9" fill="url(#cabSide)" />
            {/* plastic: coarse mould flow + fine grain */}
            <g clipPath="url(#clipCab)">
              <rect
                x="90"
                y="30"
                width="820"
                height="750"
                filter="url(#mould)"
                opacity=".07"
                style={{ mixBlendMode: 'overlay' }}
              />
              <rect
                x="90"
                y="30"
                width="820"
                height="750"
                filter="url(#grain)"
                opacity=".13"
                style={{ mixBlendMode: 'soft-light' }}
              />
            </g>
            {/* light model */}
            <rect x="90" y="30" width="820" height="750" rx="9" fill="url(#keyLight)" />
            <rect x="90" y="30" width="820" height="750" rx="9" fill="url(#cabVig)" />
            <rect x="90" y="30" width="820" height="750" rx="9" fill="url(#bounce)" />
            {/* moulded chamfers: light rolls over the top-left, occludes bottom-right */}
            <g clipPath="url(#clipCab)">
              <rect x="90" y="30" width="820" height="9" fill="url(#chamTop)" />
              <rect x="90" y="30" width="9" height="750" fill="url(#chamLeft)" />
              <rect x="90" y="765" width="820" height="15" fill="url(#chamBot)" />
              <rect x="895" y="30" width="15" height="750" fill="url(#chamRight)" />
            </g>
            <g clipPath="url(#clipCab)">
              <rect x="880" y="30" width="30" height="750" fill="url(#rimR)" />
              <rect x="90" y="750" width="820" height="30" fill="url(#rimB)" />
              {/* cabinet dust and a couple of scuffs */}
              <rect x="90" y="30" width="820" height="750" filter="url(#dust)" opacity=".07" />
            </g>
            <path d="M100 33.5H900" stroke="#89887f" strokeOpacity=".5" strokeWidth="1" />
            <path d="M100 777H900" stroke="#000" strokeOpacity=".75" strokeWidth="1.5" />
            {/* vent slots on cabinet top */}
            <g>
              <g fill="#0a0a09" opacity=".95">
                <rect x="150" y="38" width="120" height="3" rx="1.5" />
                <rect x="290" y="38" width="120" height="3" rx="1.5" />
                <rect x="590" y="38" width="120" height="3" rx="1.5" />
                <rect x="730" y="38" width="120" height="3" rx="1.5" />
              </g>
              <g fill="#8a8981" opacity=".22">
                <rect x="150" y="41.2" width="120" height="1" rx=".5" />
                <rect x="290" y="41.2" width="120" height="1" rx=".5" />
                <rect x="590" y="41.2" width="120" height="1" rx=".5" />
                <rect x="730" y="41.2" width="120" height="1" rx=".5" />
              </g>
            </g>
          </g>

          {/* ===== BEZEL (stepped) ===== */}
          <g id="bezel">
            <rect x="156" y="56" width="688" height="536" rx="7" fill="url(#lip)" />
            <path d="M160 60H840M160 60V588" stroke="#8d8c88" strokeOpacity=".6" fill="none" />
            <path d="M840 60V588M160 588H840" stroke="#000" strokeOpacity=".7" fill="none" />
            <rect x="164" y="64" width="672" height="520" rx="5" fill="url(#bezelIn)" />
            <path d="M168 68H832M168 68V580" stroke="#000" strokeOpacity=".9" fill="none" />

            {/* THE GLASS 4:3. The picture is laid over this, so it is only ever
                seen around the edges — but it is what the tube is made of, and a
                set with the picture off should still have glass in it. */}
            <rect
              id="screen"
              x="180"
              y="80"
              width="640"
              height="480"
              rx="6"
              fill="url(#glassBase)"
              filter="url(#glassIn)"
            />

            {/* The reflections and the shadow where the tube meets the bezel used
                to be drawn here, over the picture. They are drawn over it still —
                see `<GlassSurface>`, rendered into the picture itself. */}

            {/* wordmark on bezel, bottom-left, as on the real thing */}
            <text
              x="188"
              y="576"
              fontFamily="Michroma,'Chakra Petch',Eurostile,Microgramma,'Arial Narrow',sans-serif"
              fontSize="11.5"
              letterSpacing="2.6"
              fill="#bfc1c3"
            >
              TELETEXTRON
            </text>
          </g>

          {/* ===== ALUMINIUM TRIM STRIP ===== */}
          <g id="trim">
            <rect x="156" y="598" width="688" height="7" fill="url(#alu)" filter="url(#castTrim)" />
            <rect
              x="156"
              y="598"
              width="688"
              height="7"
              filter="url(#brush)"
              opacity=".35"
              style={{ mixBlendMode: 'multiply' }}
            />
            <rect x="156" y="598" width="688" height="1.6" fill="#ffffff" opacity=".55" />
            <path d="M156 605.5H844" stroke="#000" strokeOpacity=".85" />
            <path d="M156 597.2H844" stroke="#000" strokeOpacity=".5" />
          </g>

          {/* The front panel, which the phone build crops away: the same
              controls are laid out again at handset scale in
              `RemoteHandset`, rendered after the set. Not rendered rather
              than merely out of frame, so that a key nobody can see is
              also a key nothing can tab to. */}
          {/* ===== CONTROL PANEL ===== */}
          {!compact && (
            <g id="panel">
              {/* slight recess */}
              <rect x="164" y="614" width="672" height="150" rx="3" fill="#000" opacity=".26" />
              <rect x="164" y="614" width="672" height="18" fill="url(#aoTop)" opacity=".7" />
              <rect x="164" y="750" width="672" height="14" fill="url(#aoBot)" opacity=".5" />
              <path d="M166 615H834" stroke="#000" strokeOpacity=".8" />
              <path d="M166 763H834" stroke="#5c5b58" strokeOpacity=".5" />

              <g id="panel-content">
                {/* wear: polished caps on the most-used keys */}
                <g pointerEvents="none">
                  <rect x="380" y="641" width="40" height="36" rx="3" fill="url(#wear)" />
                  <rect x="564" y="685" width="40" height="36" rx="3" fill="url(#wear)" />
                  <rect x="642" y="634" width="52" height="34" rx="3" fill="url(#wear)" />
                  <rect x="700" y="634" width="52" height="34" rx="3" fill="url(#wear)" />
                </g>
                {/* greasy fingerprints on the panel plastic beside the keypad and nav */}
                <g clipPath="url(#clipPanel)" pointerEvents="none">
                  <ellipse cx="612" cy="705" rx="26" ry="18" filter="url(#smudge)" fill="url(#smudgeG)" opacity=".45" />
                  <ellipse cx="770" cy="660" rx="22" ry="16" filter="url(#smudge)" fill="url(#smudgeG)" opacity=".4" />
                  <rect x="164" y="606" width="672" height="150" filter="url(#dust)" opacity=".10" />
                </g>

                {/* LED display */}
                <g id="display">
                  <rect x="180" y="641" width="184" height="80" rx="3" fill="#000" />
                  <rect x="182" y="643" width="180" height="76" rx="2" fill="url(#win)" />
                  <g id="disp-page" transform="translate(196 659) skewX(-5)">
                    {[...pageDigits].map((glyph, index) => (
                      <SevenSegment key={index} glyph={glyph} index={index} />
                    ))}
                  </g>
                  <rect
                    className="disp-dot"
                    x="300"
                    y="698"
                    width="4"
                    height="4"
                    fill="#ff3b2c"
                    filter="url(#segGlow)"
                    opacity={lit ? 1 : 0}
                  />
                  <g id="disp-sub" transform="translate(312 671) scale(.72) skewX(-5)">
                    {[...subDigits].map((glyph, index) => (
                      <SevenSegment key={index} glyph={glyph} index={index} />
                    ))}
                  </g>
                  {/* red filter plate over the LEDs */}
                  <rect
                    x="182"
                    y="643"
                    width="180"
                    height="76"
                    rx="2"
                    fill="url(#ledFilter)"
                    pointerEvents="none"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                  {/* gloss: reflection of the room on the display's acrylic */}
                  <path
                    d="M184 645 H360 Q360 645 360 647 V672 Q290 686 184 664 Z"
                    fill="url(#winGloss)"
                    pointerEvents="none"
                    clipPath="url(#clipDisp)"
                  />
                  <text className="cap" x="240" y="737">
                    PAGE
                  </text>
                  <text className="cap" x="330" y="737">
                    SUB
                  </text>
                </g>

                {/* numeric keypad 5×2 */}
                <g id="keypad">
                  {KEYPAD.map(({ digit, x, y, hitY, hitH }) => (
                    <PanelKey
                      key={digit}
                      id={`key-${digit}`}
                      label={`Dial ${digit}`}
                      onPress={digitPress == null ? undefined : () => digitPress(digit)}
                      hit={{ x, y: hitY, width: 40, height: hitH }}
                    >
                      <use href="#k40x36" x={x} y={y} filter="url(#castKey)" />
                      <text className="lg" fill="#dcdcda" x={x + 20} y={y + 23}>
                        {digit}
                      </text>
                    </PanelKey>
                  ))}
                </g>

                {/* fastext colour keys, spanning the keypad width */}
                <g id="fastext">
                  {INDEX_LINE.map((item, index) => {
                    const x = FASTEXT_X0 + index * FASTEXT_KEY_PITCH;
                    return (
                      <PanelKey
                        key={item.fg}
                        id={`ft-${item.fg}`}
                        label={`${item.label} (page ${item.page})`}
                        onPress={fastext == null ? undefined : () => fastext(item.page)}
                        hit={{ x, y: 727, width: FASTEXT_KEY_WIDTH, height: 23 }}
                      >
                        <rect
                          x={x}
                          y="729"
                          width={FASTEXT_KEY_WIDTH}
                          height="14"
                          rx="2"
                          fill={FASTEXT_FILLS[index]}
                          stroke="#0a0a0a"
                          filter="url(#castKey)"
                        />
                        <rect
                          x={x}
                          y="729"
                          width={FASTEXT_KEY_WIDTH}
                          height="14"
                          rx="2"
                          fill="url(#ftkey)"
                        />
                      </PanelKey>
                    );
                  })}
                </g>

                {/* page (large) over subpage (small): size hierarchy */}
                <g id="page-nav">
                  <PanelKey
                    id="btn-page-down"
                    label="Previous page"
                    onPress={pageStep == null ? undefined : () => pageStep(-1)}
                    hit={{ x: 642, y: 634, width: 52, height: 34 }}
                  >
                    <use href="#k52x34" x="642" y="634" filter="url(#castKey)" />
                    <path className="lg" d="M661 651 L675 643 L675 659 Z" fill="#dcdcda" />
                  </PanelKey>
                  <PanelKey
                    id="btn-page-up"
                    label="Next page"
                    onPress={pageStep == null ? undefined : () => pageStep(1)}
                    hit={{ x: 700, y: 634, width: 52, height: 34 }}
                  >
                    <use href="#k52x34" x="700" y="634" filter="url(#castKey)" />
                    <path className="lg" d="M733 651 L719 643 L719 659 Z" fill="#dcdcda" />
                  </PanelKey>
                  <text className="cap" x="697" y="683">
                    PAGE
                  </text>
                </g>
                <g id="sub-nav">
                  <PanelKey
                    id="btn-sub-prev"
                    label={`Previous subpage (showing ${subpage} of ${subpageCount})`}
                    onPress={subpageStep == null ? undefined : () => subpageStep(-1)}
                    hit={{ x: 654, y: 690, width: 40, height: 34 }}
                  >
                    <use href="#k40x26" x="654" y="698" filter="url(#castKey)" />
                    <path className="lg" d="M669 711 L679 705 L679 717 Z" fill="#dcdcda" />
                  </PanelKey>
                  <PanelKey
                    id="btn-sub-next"
                    label={`Next subpage (showing ${subpage} of ${subpageCount})`}
                    onPress={subpageStep == null ? undefined : () => subpageStep(1)}
                    hit={{ x: 700, y: 690, width: 40, height: 34 }}
                  >
                    <use href="#k40x26" x="700" y="698" filter="url(#castKey)" />
                    <path className="lg" d="M725 711 L715 705 L715 717 Z" fill="#dcdcda" />
                  </PanelKey>
                  <text className="cap" x="697" y="741">
                    SUBPAGE
                  </text>
                </g>

                {/* power */}
                <g id="power">
                  <PanelKey
                    id="btn-power"
                    label={lit ? 'Switch the television off' : 'Switch the television on'}
                    onPress={togglePower}
                    hit={{ x: 766, y: 638, width: 66, height: 48 }}
                  >
                    <use href="#k34" x="782" y="647" filter="url(#castKey)" />
                    <circle
                      className="lg"
                      cx="799"
                      cy="660"
                      r="6.5"
                      fill="none"
                      stroke="#dcdcda"
                      strokeWidth="1.6"
                    />
                    <line
                      className="lg"
                      x1="799"
                      y1="651"
                      x2="799"
                      y2="659"
                      stroke="#dcdcda"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </PanelKey>
                  <text className="cap" x="799" y="693">
                    POWER
                  </text>
                  <circle
                    id="led-power"
                    cx="799"
                    cy="715"
                    r="4.5"
                    fill={lit ? 'url(#ledG)' : 'url(#ledR)'}
                  />
                  <circle cx="799" cy="715" r="7" fill="none" stroke="#000" strokeOpacity=".7" />
                </g>
              </g>
            </g>
          )}
        </svg>

        {/*
          * The picture, laid over the cabinet's glass rather than inside it.
          *
          * After the SVG in the DOM and positioned on top of it, covering exactly
          * the tube and nothing else — so the front panel below stays the SVG's to
          * handle and needs nothing done to it. The glass's own surface goes back
          * over the top from in here.
          */}
        <div className="crt-glass">
          <div className="crt-raster">{children}</div>
          <div className="crt-beam" />
          <div className="crt-dot" />
          <div className="crt-scanlines" />
          <GlassSurface />
        </div>
      </div>

      {/*
        * The panel that was cropped off the cabinet, as something you hold.
        *
        * A sibling of the set rather than a child of it, because `.crt-glass`
        * is placed as a percentage of `.crt-tv` and a handset inside that box
        * would grow it — moving the picture off the tube. Where it ends up on
        * the page is the layout's business (see `.crt-remote` in `App.css`);
        * what matters here is that the set and its remote share one set of
        * state, so the LED window on the handset is the set's own.
        */}
      {compact && (
        <RemoteHandset
          pageDigits={pageDigits}
          subDigits={subDigits}
          lit={lit}
          subpage={subpage}
          subpageCount={subpageCount}
          onDigit={digitPress}
          onPageStep={pageStep}
          onSubpageStep={subpageStep}
          onFastext={fastext}
          onPower={togglePower}
        />
      )}
    </>
  );
}

export default CrtTelevision;
