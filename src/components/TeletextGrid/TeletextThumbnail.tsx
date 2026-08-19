/**
 * A teletext page as a picture: one `<canvas>` instead of ~1,500 `<div>`s.
 *
 * {@link TeletextGrid} exists to be interacted with — a cursor lands in it, a
 * brush paints it, a cell blinks — and that is what its per-cell elements buy.
 * When a page is only being *looked at*, none of that is used and the cost is
 * real: nine grids on the front page came to 12,000 DOM nodes on the first
 * screen a visitor meets.
 *
 * The drawing is `utils/pageCanvas.ts`, shared with the PNG export, so a
 * thumbnail and a downloaded page are the same picture.
 */

import { useEffect, useRef } from 'react';

import type { TeletextPage } from '../../types/teletext';
import { PAGE_W, ROWS, drawPage, pageHeight } from '../../utils/pageCanvas';

export interface TeletextThumbnailProps {
  page: TeletextPage;
  pageNumber: number;
  subpage?: number;
  subpageCount?: number;
  /** The fastext strip. Off by default: on a wall of these it is a repeated smear. */
  showIndexLine?: boolean;
  /** Leave off the page number, counter and clock, and lose the row with them. */
  skipHeaderRow?: boolean;
  /**
   * How tall the thing is, and whether its row 0 is a header. Defaults are a
   * full 24-row page with one; a guestbook snippet is eight rows with none.
   */
  rows?: number;
  headerRow?: boolean;
  /** Alternative text. Empty (the default) marks it decorative. */
  alt?: string;
  /**
   * Backing-store size as a fraction of the page's natural 560x432.
   *
   * A canvas costs width x height x 4 bytes whatever it is displayed at, so a
   * strip of two dozen at full size would be tens of megabytes. Half is still
   * ample for a tile a couple of hundred pixels wide on a retina screen.
   */
  scale?: number;
}

export function TeletextThumbnail({
  page,
  pageNumber,
  subpage = 1,
  subpageCount = 1,
  showIndexLine = false,
  skipHeaderRow = false,
  rows = ROWS,
  headerRow = true,
  alt = '',
  scale = 1,
}: TeletextThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) return;

    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The scale goes to `drawPage`, not to the context: the cell geometry has
      // to be snapped to whole device pixels after scaling or thin seams show
      // between the cells.
      drawPage(ctx, page, {
        pageNumber,
        subpage,
        subpageCount,
        showIndexLine,
        skipHeaderRow,
        rows,
        headerRow,
        scale,
      });
    };

    // Drawn once now and again once the webfont has loaded. Canvas text takes
    // whatever font is available *at the moment it is drawn* and keeps it —
    // unlike DOM text, it does not re-render itself when a font arrives, so a
    // first paint before "Press Start 2P" is ready would stay in the fallback
    // for the life of the page.
    paint();
    document.fonts?.ready.then(paint).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    page,
    pageNumber,
    subpage,
    subpageCount,
    showIndexLine,
    skipHeaderRow,
    rows,
    headerRow,
    scale,
  ]);

  return (
    <canvas
      ref={canvasRef}
      /* The backing store is the page's natural size; CSS decides how big it is
         drawn. Downscaled by the browser with smoothing, which at tile size
         reads better than the hard pixel edges `image-rendering: pixelated`
         would give. */
      width={Math.round(PAGE_W * scale)}
      height={Math.round(pageHeight(headerRow && skipHeaderRow, rows) * scale)}
      className="teletext-thumbnail"
      role={alt === '' ? 'presentation' : 'img'}
      aria-label={alt === '' ? undefined : alt}
    />
  );
}

export default TeletextThumbnail;
