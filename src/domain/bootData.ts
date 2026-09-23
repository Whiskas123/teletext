/**
 * The pages as the build last saw them, for the seconds before playhtml syncs.
 *
 * ## The problem this solves
 *
 * Every page lives in one playhtml document, and playhtml hands over nothing
 * until the whole of it has arrived: a hundred pages of cell objects, plus the
 * history of every edit ever made to them. On the live site that took about ten
 * seconds, and for all of them the television was blank and the header said it
 * had no connection.
 *
 * The same pages are already in the database — `scripts/prerender.ts` reads
 * them to write the archive's HTML — so the build also writes them out as one
 * static file. A viewer draws from that file the moment it lands (a CDN fetch,
 * brotli'd to a fraction of the document) and switches to the live channels as
 * soon as playhtml has synced. See `src/collab/bootData.ts` for that half.
 *
 * ## Only ever read
 *
 * The file is as fresh as the last deploy and the last backup, so it is a
 * picture of the pages rather than the pages. Nothing writes it back: the hooks
 * that write (the editor, publishing, the backup itself) keep reading the live
 * document and nothing else.
 */

import { TOTAL_CELLS, type TeletextPage } from '../types/teletext';
import type { PageKinds } from './directory';
import { isEmptyCell, normalizePage } from './pageOps';
import type { PageCellMap } from './pageEncoding';
import type { SubpageCounts } from './subpages';

/** Where the build writes the file, and where the app fetches it from. */
export const BOOT_DATA_PATH = '/boot/pages.json';

/**
 * The channels the file carries, in the shape each one has in playhtml, keyed
 * by the channel's own id — so a hook can take its fallback by the same name it
 * reads the live channel by.
 */
export interface BootData {
  pages: Record<string, PageCellMap>;
  'subpage-counts': SubpageCounts;
  titles: Record<number, string>;
  'page-kinds': PageKinds;
}

export type BootChannel = keyof BootData;

/**
 * A page as the file stores it: the cell map, without the empty cells.
 *
 * Every reader already treats a missing cell as the empty one (it goes through
 * `normalizePage`), and most of a teletext page is black — so leaving them out
 * roughly halves the file before compression has even started.
 */
export function bootPage(page: unknown): PageCellMap {
  const cells: TeletextPage = normalizePage(page);
  const map: PageCellMap = {};
  for (let index = 0; index < TOTAL_CELLS; index += 1) {
    if (!isEmptyCell(cells[index])) map[index] = cells[index];
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The parsed file, or `null` when it is not one.
 *
 * Only the outline is checked. What is inside each channel gets the same repair
 * the live document gets — every page passes through `normalizePage` on its way
 * to the screen — so a bad cell costs a cell, not the file.
 */
export function parseBootData(value: unknown): BootData | null {
  if (!isRecord(value)) return null;
  const channels: BootChannel[] = ['pages', 'subpage-counts', 'titles', 'page-kinds'];
  return channels.every((channel) => isRecord(value[channel]))
    ? (value as unknown as BootData)
    : null;
}
