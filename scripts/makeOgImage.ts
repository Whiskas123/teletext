/**
 * Generates `public/og.png` — the picture that stands in for the site when a
 * link to it is posted somewhere.
 *
 * It is the front page's lockup: the mascot, and `Tele-` / `textual` set beside
 * it over two lines in the teletext face, on black, over the four-colour
 * fastext strip. Same composition as `.frontpage-title`, down to the break
 * between the two lines being part of the wordmark rather than something a
 * viewport decided.
 *
 * ## Why this is a script and not a build step
 *
 * The image does not change unless the mascot, the name or the palette does, so
 * it is generated once and the result committed:
 *
 *     bun run og:image
 *
 * Running it on every deploy would spend build time reproducing a file that is
 * already correct, and would put `sharp` — a dev dependency with a
 * platform-specific binary — on the critical path of the deploy.
 *
 * ## Why the lettering is converted to paths
 *
 * Neither ordinary way of drawing text here works. librsvg, which `sharp`
 * renders SVG with, ignores `@font-face` even with the font inlined as a data
 * URI; and the prebuilt libvips ships without the `text` operation, so
 * `sharp`'s own text renderer is not available either. Both fail *quietly* —
 * the first produced a black rectangle with no error.
 *
 * So the glyphs are read out of `EuropeanTeletext.ttf` with `opentype.js` and
 * emitted as `<path>` data, which librsvg has no opinion about. The font is a
 * build-time input and not a runtime one, which is what makes this reproducible
 * on a machine with different fonts installed.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

/** The size every scraper wants: 1.91:1, large enough not to be re-cropped. */
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * The strip along the bottom of a teletext page — red, green, yellow, cyan, in
 * that order, which is the order the buttons were on the remote.
 */
const FASTEXT = ['#ff0000', '#00ff00', '#ffff00', '#00ffff'];
const STRIP_HEIGHT = 44;

/** The wordmark, broken where `PROJECT_NAME_LINES` breaks it. */
const LINES = ['Tele-', 'textual'];

/** `.frontpage-name`'s: tight enough that two lines read as one wordmark. */
const LINE_HEIGHT = 0.92;

/**
 * How wide the whole lockup is allowed to be, and the gap as a share of the
 * mascot's side.
 *
 * These two are what the composition actually has left to choose, because
 * everything else is fixed: the lettering has to be exactly as tall as the
 * mascot (see below), and `textual` is seven characters of a monospaced face,
 * so the lockup is always about 4.5 times as wide as it is tall. Its *height*
 * therefore follows from how much width it may occupy, rather than being picked
 * — which is why `LOGO_SIZE` below is derived and not a number written here.
 *
 * 1020 of 1200 leaves 90 a side. A link card is often shown small, and a
 * wordmark running to the bleed reads as a cropping accident at that size.
 */
const MARK_WIDTH = 1020;
const GAP_RATIO = 0.28;

const root = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const font = opentype.parse(
    (await readFile(`${root}src/assets/EuropeanTeletext.ttf`)).buffer as ArrayBuffer,
  );

  const logo = await readFile(`${root}public/logo.png`);
  const { width: logoNative = 0 } = await sharp(logo).metadata();

  /*
   * The lettering, measured by its *ink* rather than by font metrics.
   *
   * The two have to agree exactly — the wordmark is as tall as the mascot
   * beside it, which is the whole of what makes this read as one mark and not
   * as a picture with a caption — and only the ink can be made to agree.
   * Ascent, descent and line-gap describe a box the glyphs sit somewhere
   * inside, with slack that differs per face, so matching those would leave the
   * visible lettering short of the mascot by an amount nobody can predict.
   *
   * Measured at an arbitrary reference size and then scaled, because the
   * outlines are linear: one measurement fixes the shape of the block, and the
   * size is solved for afterwards.
   */
  const REFERENCE = 100;
  const paths = LINES.map((text, i) =>
    font.getPath(text, 0, i * REFERENCE * LINE_HEIGHT, REFERENCE),
  );
  const boxes = paths.map((path) => path.getBoundingBox());
  const inkLeft = Math.min(...boxes.map((b) => b.x1));
  const inkTop = Math.min(...boxes.map((b) => b.y1));
  const inkWidth = Math.max(...boxes.map((b) => b.x2)) - inkLeft;
  const inkHeight = Math.max(...boxes.map((b) => b.y2)) - inkTop;

  // Solve the lockup's height from the width it may occupy:
  //   MARK_WIDTH = logo + gap + lettering
  //              = L + L*GAP_RATIO + L*(inkWidth / inkHeight)
  const logoSize = Math.round(
    MARK_WIDTH / (1 + GAP_RATIO + inkWidth / inkHeight),
  );
  const gap = Math.round(logoSize * GAP_RATIO);

  // The factor that makes the ink exactly `logoSize` tall. Applied as an SVG
  // transform, with the ink's own origin taken out first, so the block lands on
  // its top-left corner rather than on a baseline.
  const scale = logoSize / inkHeight;
  const letteringWidth = inkWidth * scale;

  /*
   * Nearest-neighbour, though the factor is not a whole number.
   *
   * The usual reason to insist on whole-number scaling does not apply: the art
   * is 156px native with no coarser grid inside it — checked, and it is clean
   * at 156 and at nothing else — and the file has been through lossy
   * compression at some point, so it carries about 2,600 colours rather than
   * two. There is no pixel grid here whose regularity could be preserved. What
   * is left to protect is the hard edge, and `nearest` keeps it where
   * `lanczos3` visibly softens it. Both were rendered and compared.
   */
  const scaledLogo = await sharp(logo)
    .resize(logoSize, logoSize, { kernel: 'nearest' })
    .toBuffer();

  const markWidth = logoSize + gap + letteringWidth;
  const markLeft = Math.round((WIDTH - markWidth) / 2);
  // Centred in what the strip leaves rather than in the whole canvas —
  // otherwise it sits visibly low.
  const markTop = Math.round((HEIGHT - STRIP_HEIGHT - logoSize) / 2);
  const letteringLeft = markLeft + logoSize + gap;

  const stripWidth = WIDTH / FASTEXT.length;
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
      `<g transform="translate(${letteringLeft} ${markTop}) scale(${scale}) ` +
      `translate(${-inkLeft} ${-inkTop})" fill="#ffffff">` +
      paths.map((path) => `<path d="${path.toPathData(2)}"/>`).join('') +
      `</g>` +
      FASTEXT.map(
        (color, i) =>
          `<rect x="${i * stripWidth}" y="${HEIGHT - STRIP_HEIGHT}" ` +
          `width="${stripWidth}" height="${STRIP_HEIGHT}" fill="${color}"/>`,
      ).join('') +
      `</svg>`,
  );

  const png = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      { input: scaledLogo, left: markLeft, top: markTop },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  await writeFile(`${root}public/og.png`, png);

  console.log(
    `public/og.png — ${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB\n` +
      `  mascot ${logoNative}px native, drawn at ${logoSize}px\n` +
      `  lettering ${Math.round(letteringWidth)}x${logoSize}px — same height as the mascot\n` +
      `  lockup ${Math.round(markWidth)}px wide, ${markLeft}px each side`,
  );
}

await main();
