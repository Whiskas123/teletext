/**
 * Reading a corpus image as raw pixels, outside a browser.
 *
 * `src/utils/archiveImage.ts` does this job in the app, but it is built on
 * `createImageBitmap` and a canvas, so the batch import cannot use it. The
 * decoder itself (`domain/archiveImport.ts`) is pure and takes a structural
 * `SourcePixels`, so only the pixel source has to be replaced — the decoding is
 * the same code the app runs.
 *
 * ## Fidelity is the whole problem
 *
 * `importArchiveImage` requires every pixel to be exactly one of the eight
 * teletext palette colours, and counts the ones that are not as
 * `snappedPixels`. A decoder that resamples, colour-manages, or premultiplies
 * would shift flat colours by a digit or two and quietly produce a page that
 * looks right and is wrong. So:
 *
 * - **No resize.** The image is read at its stored size; `profileFor` then
 *   decides whether that size is a render it recognises.
 * - **No ICC handling.** An embedded profile is ignored rather than applied,
 *   matching the browser path's `colorSpaceConversion: 'none'`.
 * - **No premultiplication.** `ensureAlpha` adds an opaque alpha channel where
 *   one is missing without touching the colour channels.
 * - **First frame only.** A GIF that happens to be animated contributes its
 *   first frame, not a filmstrip.
 *
 * `scripts/verifyDecoder.ts` checks this against fixtures whose pixels were
 * produced by the browser path, so a divergence between libvips and canvas
 * shows up as a failing check rather than as a corrupt corpus.
 */

import sharp from 'sharp';

import type { SourcePixels } from '../../src/domain/archiveImport';

/** Read `path` as raw RGBA at its stored size. */
export async function loadImageNode(path: string): Promise<SourcePixels> {
  const { data, info } = await sharp(path, {
    // An animated GIF would otherwise be read as a vertical filmstrip.
    animated: false,
    // Do not let libvips act on an embedded colour profile.
    ignoreIcc: true,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(
      `Expected 4 channels from ${path}, got ${info.channels}. ` +
        'The decoder reads RGBA and would misread anything else.',
    );
  }

  const expected = info.width * info.height * 4;
  if (data.length !== expected) {
    throw new Error(
      `Pixel buffer for ${path} is ${data.length} bytes, expected ${expected} ` +
        `for ${info.width}x${info.height} RGBA.`,
    );
  }

  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}
