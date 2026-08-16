import type { TeletextPage } from '../types/teletext';
import { PAGE_H, PAGE_W, drawPage, type DrawPageOptions } from './pageCanvas';

/**
 * Export the teletext page as a PNG and trigger download.
 *
 * The drawing itself is `utils/pageCanvas.ts`, shared with the front page's
 * thumbnails so the two cannot disagree about what a page looks like. This is
 * the file-handling half: make a canvas, draw, hand the blob to the browser.
 */
export function exportPageAsPng(
  page: TeletextPage,
  filename = 'teletext.png',
  pageNumber = 100,
  options: Omit<DrawPageOptions, 'pageNumber'> = {},
): void {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  drawPage(ctx, page, { ...options, pageNumber });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
