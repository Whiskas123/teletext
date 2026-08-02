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
export type PageKind = 'category' | 'subcategory' | 'page';

/** Every kind, for building a picker. */
export const PAGE_KINDS: readonly PageKind[] = ['category', 'subcategory', 'page'];

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
  return value === 'category' || value === 'subcategory' || value === 'page';
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
 * Headings that appear before any parent are simply promoted: a subcategory
 * with no category above it sits at the top level, and pages before the first
 * heading sit at the top level too. A directory always lists every page it was
 * given, whatever state the kinds are in — a page that vanished from the index
 * because someone had not yet marked a heading would be worse than a slightly
 * flat tree.
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
  let category: DirectoryNode | null = null;
  let subcategory: DirectoryNode | null = null;

  for (const entry of ordered) {
    const kind = isPageKind(entry.kind) ? entry.kind : DEFAULT_PAGE_KIND;

    if (kind === 'category') {
      category = node(entry, kind);
      subcategory = null;
      root.push(category);
      continue;
    }

    if (kind === 'subcategory') {
      subcategory = node(entry, kind);
      if (category == null) root.push(subcategory);
      else category.children.push(subcategory);
      continue;
    }

    const leaf = node(entry, kind);
    if (subcategory != null) subcategory.children.push(leaf);
    else if (category != null) category.children.push(leaf);
    else root.push(leaf);
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
