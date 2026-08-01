/**
 * A capture's actual render, as stored in the archive.
 *
 * This replaces a canvas that drew one palette colour per cell from a 960-byte
 * summary. The idea was that a page is recognisable by layout and colour before
 * it is readable; that holds for a graphics-heavy page and fails for almost
 * every page here, because teletext is mostly text and reducing a cell to one
 * colour throws the glyph away. The result was a smear of dots.
 *
 * So this is the real image — the GIF or PNG the archive holds, re-encoded
 * losslessly. It costs about 2.2 KB, which is less than the original file and
 * only a little more than the summary it replaces, for something you can
 * actually read.
 *
 * `loading="lazy"` matters at this scale: a filter can match well over a
 * thousand captures, and only what scrolls into view should be fetched. Each
 * response is cached for a year, since a capture's render never changes.
 */

export interface CaptureImageProps {
  captureId: number;
  /** Whether the archive holds an image for this capture. */
  hasImage?: boolean;
  /** Accessible description, e.g. the page it shows. */
  label: string;
  className?: string;
}

export function CaptureImage({
  captureId,
  hasImage = true,
  label,
  className,
}: CaptureImageProps) {
  const classes = className == null ? 'capture-image' : `capture-image ${className}`;

  if (!hasImage) {
    // An explicit placeholder rather than a broken image: some captures were
    // imported before renders were stored, and that is worth seeing plainly.
    return (
      <div className={`${classes} capture-image-missing`} role="img" aria-label={`${label} — no image stored`}>
        <span>no image</span>
      </div>
    );
  }

  return (
    <img
      className={classes}
      src={`/api/captures/${captureId}?format=image`}
      alt={label}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export default CaptureImage;
