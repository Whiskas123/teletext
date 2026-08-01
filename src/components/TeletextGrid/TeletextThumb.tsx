/**
 * A capture drawn as a postage stamp, from its thumbnail string.
 *
 * The archive browser shows sixty of these at once. A real `TeletextGrid` is
 * 960 DOM nodes, so sixty would be 57,600 — enough to make scrolling the
 * browser unpleasant on its own, before counting the megabytes of cell data it
 * would take to feed them.
 *
 * Instead each capture arrives as 960 palette digits (see
 * `domain/thumbnail.ts`) and is drawn to a 40x24 canvas — one pixel per cell —
 * which CSS then scales up with `image-rendering: pixelated`. One node and a
 * kilobyte per capture, and the result is a fair likeness: teletext is already
 * flat colour on a grid, so the only thing lost is the glyph shapes, which were
 * never legible at this size anyway.
 */

import { useEffect, useRef } from 'react';

import { decodeThumbnail } from '../../domain/thumbnail';
import { COLS, ROWS, TELETEXT_COLOR_HEX, TELETEXT_COLORS } from '../../types/teletext';

/** Palette as packed RGBA, in `TELETEXT_COLORS` order, for direct pixel writes. */
const PALETTE_RGBA = TELETEXT_COLORS.map((color) => {
  const hex = TELETEXT_COLOR_HEX[color];
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  // Little-endian ABGR, which is what a Uint32 view of ImageData wants.
  return (255 << 24) | (b << 16) | (g << 8) | r;
});

export interface TeletextThumbProps {
  /** 960 palette digits, or `null`/malformed to render nothing. */
  thumbnail: unknown;
  /** Accessible description, e.g. the page it shows. */
  label?: string;
  className?: string;
}

export function TeletextThumb({ thumbnail, label, className }: TeletextThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const context = canvas.getContext('2d');
    if (context == null) return;

    const indices = decodeThumbnail(thumbnail);
    if (indices == null) {
      context.clearRect(0, 0, COLS, ROWS);
      return;
    }

    // One canvas pixel per cell; the upscale is CSS's job so the browser can
    // do it on the GPU and we never hold a large bitmap.
    const image = context.createImageData(COLS, ROWS);
    const pixels = new Uint32Array(image.data.buffer);
    for (let i = 0; i < indices.length; i += 1) {
      pixels[i] = PALETTE_RGBA[indices[i]] ?? PALETTE_RGBA[0];
    }
    context.putImageData(image, 0, 0);
  }, [thumbnail]);

  return (
    <canvas
      ref={canvasRef}
      width={COLS}
      height={ROWS}
      className={className == null ? 'teletext-thumb' : `teletext-thumb ${className}`}
      role="img"
      aria-label={label ?? 'Page thumbnail'}
    />
  );
}

export default TeletextThumb;
