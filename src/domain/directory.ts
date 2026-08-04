/**
 * The Yellow Pages directory: a flat list of pages read as a tree.
 *
 * A teletext service is organised in sections — an index page, then NOTÍCIAS,
 * DESPORTO, and so on, each with its own run of pages beneath it. The directory
 * should show that shape rather than several hundred titles in one column.
 *
 * ## The tree is derived, not stored
 *
 * Each page carries only a {@link PageKind}: is it a section heading, a
 * sub-heading, or an ordinary page? The nesting comes from reading pages in
 * ascending number order and letting each heading own what follows it, until
 * the next heading at the same level or above.
 *
 * That is how teletext already works — page numbers *are* the ordering, and a
 * section is a range of them — and it has two practical consequences:
 *
 * - **Nothing can be orphaned or point at a missing parent.** Parent links
 *   would need repairing every time a page moved or was deleted; there is
 *   nothing here to repair.
 * - **Moving a block moves a whole section, intact.** `Move pages 200–210 so
 *   they start at 300` on the manage screen carries the heading and its pages
 *   together, and the tree comes out the same on the other side, because the
 *   tree is only ever a reading of the order.
 *
 * Pure and framework-free, so the shape is tested directly rather than through
 * a rendered popup.
 */

/** What a page is, structurally, in the directory. */
export type PageKind =
  | 'category'
  | 'subcategory'
  | 'subsubcategory'
  | 'page';

/**
 * The heading kinds, outermost first. Position *is* depth.
 *
 * Adding a level means adding it to this list and nothing else: the nesting, the
 * orphan promotion and the occupancy check all read depth from here rather than
 * naming the kinds one at a time, which is what made the third level a one-line
 * change instead of four separate `||` chains to keep in step.
 */
export const HEADING_KINDS = [
  'category',
  'subcategory',
  'subsubcategory',
] as const satisfies readonly PageKind[];

/** Every kind, for building a picker. */
export const PAGE_KINDS: readonly PageKind[] = [...HEADING_KINDS, 'page'];

/**
 * How deep a heading sits, or `null` for an ordinary page.
 *
 * 0 is a category, 1 a subcategory, and so on.
 */
export function headingLevel(kind: PageKind): number | null {
  const index = HEADING_KINDS.indexOf(kind as (typeof HEADING_KINDS)[number]);
  return index === -1 ? null : index;
}

/** Whether this kind owns the listings that follow it. */
export function isHeadingKind(kind: PageKind): boolean {
  return headingLevel(kind) !== null;
}

/** The kind a page has when nothing says otherwise. */
export const DEFAULT_PAGE_KIND: PageKind = 'page';

/** Kinds keyed by page number, as stored alongside titles. */
export type PageKinds = Record<number, PageKind>;

/** A page as the directory lists it, with anything filed beneath it. */
export interface DirectoryNode {
  pageNumber: number;
  /** The page's title, or `''` when it has none. */
  title: string;
  kind: PageKind;
  /** Pages filed under this heading; always empty for an ordinary page. */
  children: DirectoryNode[];
}

/** The flat input: what a page is called and what kind it is. */
export interface DirectoryEntry {
  pageNumber: number;
  title: string;
  kind?: PageKind;
}

/** Whether `value` is a kind we recognise. */
export function isPageKind(value: unknown): value is PageKind {
  return PAGE_KINDS.some((kind) => kind === value);
}

/** The stored kind for a page, defaulting to an ordinary page. */
export function kindAt(kinds: PageKinds | undefined, pageNumber: number): PageKind {
  const raw = kinds?.[pageNumber];
  return isPageKind(raw) ? raw : DEFAULT_PAGE_KIND;
}

function node(entry: DirectoryEntry, kind: PageKind): DirectoryNode {
  return {
    pageNumber: entry.pageNumber,
    title: entry.title,
    kind,
    children: [],
  };
}

/**
 * Read a flat listing as a tree.
 *
 * Entries are taken in ascending page order regardless of the order given, so
 * the result depends only on the numbers — the same property the reordering
 * tools rely on.
 *
 * Headings that appear before any parent are simply promoted: a subcategory with
 * no category above it sits at the top level, a subsubcategory files under
 * whichever of the two is open and goes to the top level if neither is, and pages
 * before the first heading sit at the top level too. A directory always lists
 * every page it was given, whatever state the kinds are in — a page that vanished
 * from the index because someone had not yet marked a heading would be worse than
 * a slightly flat tree.
 */
export function buildDirectory(entries: readonly DirectoryEntry[]): DirectoryNode[] {
  // The listing comes from playhtml, which any client can write to, so an
  // entry that is not a page at all is dropped rather than trusted. The rest of
  // the domain treats that store the same way — see `normalizePage`.
  const ordered = entries
    .filter(
      (entry): entry is DirectoryEntry =>
        entry != null &&
        typeof entry === 'object' &&
        Number.isInteger((entry as DirectoryEntry).pageNumber),
    )
    .map((entry) => ({
      pageNumber: entry.pageNumber,
      title: typeof entry.title === 'string' ? entry.title : '',
      kind: entry.kind,
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const root: DirectoryNode[] = [];
  /**
   * The heading currently open at each level, or null.
   *
   * A stack rather than one variable per level, so the number of levels is
   * `HEADING_KINDS.length` and nothing here has to be touched to change it.
   */
  const open: (DirectoryNode | null)[] = HEADING_KINDS.map(() => null);

  /** The innermost heading still open above `level`, or null for the top. */
  const parentAbove = (level: number): DirectoryNode | null => {
    for (let above = level - 1; above >= 0; above -= 1) {
      const candidate = open[above];
      if (candidate != null) return candidate;
    }
    return null;
  };

  for (const entry of ordered) {
    const kind = isPageKind(entry.kind) ? entry.kind : DEFAULT_PAGE_KIND;
    const level = headingLevel(kind);

    if (level != null) {
      const heading = node(entry, kind);
      const parent = parentAbove(level);
      if (parent == null) root.push(heading);
      else parent.children.push(heading);

      open[level] = heading;
      // Anything deeper belonged to the previous heading at this level.
      for (let deeper = level + 1; deeper < open.length; deeper += 1) {
        open[deeper] = null;
      }
      continue;
    }

    // An ordinary page is filed under the innermost heading still open.
    const leaf = node(entry, kind);
    const parent = parentAbove(open.length);
    if (parent == null) root.push(leaf);
    else parent.children.push(leaf);
  }

  return root;
}

/** Every page in a tree, depth-first, as it reads on screen. */
export function flattenDirectory(nodes: readonly DirectoryNode[]): DirectoryNode[] {
  const out: DirectoryNode[] = [];
  const walk = (list: readonly DirectoryNode[]): void => {
    for (const item of list) {
      out.push(item);
      walk(item.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * How many pages a heading covers, itself included. Used to tell the operator
 * what a section contains before they move it.
 */
export function sectionSize(node: DirectoryNode): number {
  return 1 + node.children.reduce((total, child) => total + sectionSize(child), 0);
}

/**
 * The page-number span a heading owns: itself through its last descendant.
 *
 * This is what the manage screen hands to a block move, so "move this section"
 * is one action rather than working out the range by eye.
 */
export function sectionRange(node: DirectoryNode): { start: number; end: number } {
  const pages = flattenDirectory([node]).map((item) => item.pageNumber);
  return { start: Math.min(...pages), end: Math.max(...pages) };
}
