/**
 * Turn a picked file into the pixels `domain/archiveImport.ts` decodes.
 *
 * The browser already decodes GIF, PNG and the rest, so this is only the
 * plumbing: decode the file, draw it to a canvas at its natural size, read the
 * bytes back. Kept apart from the decoder so that stays pure and testable.
 *
 * Fidelity matters more than usual here — the decoder relies on every pixel
 * being exactly a palette colour — so the canvas is set up to neither smooth
 * nor colour-manage anything on the way through.
 */

import { ArchiveImportError, type SourcePixels } from '../domain/archiveImport';

/** Decode `file` into an image, via `createImageBitmap` where available. */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `premultiplyAlpha: 'none'` keeps flat colours exactly as authored;
      // `colorSpaceConversion: 'none'` stops a display profile shifting them.
      return await createImageBitmap(file, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    } catch {
      // Fall through to the <img> path, which handles a few older formats
      // createImageBitmap declines.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new ArchiveImportError(`Could not read ${file.name} as an image.`));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read `file` as raw RGBA pixels at its natural size.
 *
 * @throws {ArchiveImportError} if the file is not a decodable image, or the
 * canvas cannot be read back (which in practice means the page is somewhere
 * a 2D context is unavailable).
 */
export async function loadArchiveImage(file: File): Promise<SourcePixels> {
  const image = await decodeImage(file);
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;

  if (width === 0 || height === 0) {
    throw new ArchiveImportError(`${file.name} has no image data.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context == null) {
    throw new ArchiveImportError('This browser would not provide a canvas to read the image with.');
  }
  // Drawing 1:1 should never resample, but an enabled smoother has been known
  // to soften edges anyway, and a softened edge is a mis-read pixel here.
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);

  if ('close' in image) image.close();

  return context.getImageData(0, 0, width, height);
}
