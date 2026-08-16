/**
 * ImportArchivePage — `/import`: turn teletext archive renders into pages, a
 * folder at a time.
 *
 * The archive's renderer emits GIFs on an exact pixel grid, so there is
 * nothing to line up and nothing to recognise — see `domain/archiveImport.ts`
 * for why the decode is exact rather than approximate. What is left for a
 * person is only ever two things, and the screen is built around them:
 *
 * **Where does each page go.** The render does not carry its own number (the
 * archive blanks the header row), but its filename does — `163-01.gif` is page
 * 163. Every dropped file gets its number read off its name and shown, big and
 * editable, on its card. So the normal case is: drop a folder, glance down the
 * sheet, import. Anything the filename did not answer is an empty box asking
 * to be filled, and two files aimed at the same page light up as a clash.
 *
 * **What is that character.** Unrecognised stencils are pooled across the
 * *whole batch* rather than per file, which is the thing that makes a big
 * import bearable: a `Z` appearing on nine pages is one box to fill in, and
 * answering it re-decodes all nine at once.
 *
 * The card thumbnails are the source GIFs themselves. That is not a shortcut —
 * the decode is exact, so the render *is* the preview, and clicking a card
 * puts it next to the decoded page at full size to prove it.
 *
 * Who may import where is `domain/access.ts`'s rule, the same one normal
 * editing uses: anyone into a playground page, moderator only into the archive.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { usePageTitles } from '../../collab/useGuide';
import { useImportPages } from '../../collab/useImportPages';
import { useLearnedGlyphs } from '../../collab/useLearnedGlyphs';
import { useIsModerator } from '../../collab/useIsModerator';
import { PLAYGROUND_MIN_PAGE } from '../../domain/access';
import {
  blocksImport,
  chooseOnePerPage,
  describeIssue,
  duplicatePageNumbers,
  entryIssue,
  parseArchiveFileName,
  sequentialPageNumbers,
  type ArchiveFileInfo,
  type EntryIssue,
} from '../../domain/importBatch';
import {
  RENDER_PROFILES,
  acceptedSizes,
  importArchiveImage,
  type ImportResult,
} from '../../domain/archiveImport';
import { loadArchiveImage } from '../../utils/archiveImage';
import { createEmptyPage } from '../../types/teletext';
import { TeletextGrid } from '../TeletextGrid/TeletextGrid';

/*
 * Characters taught on this screen live in the database behind
 * `useLearnedGlyphs`, with `localStorage` kept only as a cache in front of it.
 * They used to be browser-local, which meant every character taught existed on
 * exactly one machine. Pasting the copied lines into `glyphAtlas.ts` is still
 * what makes a character part of the shipped atlas.
 */

/** One dropped file, and everything derived from it. */
interface Entry {
  id: string;
  fileName: string;
  /** Object URL for the thumbnail; revoked when the entry goes. */
  objectUrl: string;
  /**
   * Kept instead of the decoded pixels, which are ~830 KB each and would run
   * into hundreds of megabytes over an archive dump. Teaching a character
   * re-reads only the handful of files that actually contain that stencil, so
   * holding all of them decoded would buy nothing.
   */
  file: File;
  /** What the filename says: page, screen, capture date. */
  info: ArchiveFileInfo;
  result: ImportResult | null;
  unreadable: string | null;
  /** Draft text, so the box can be empty while being retyped. */
  pageDraft: string;
  /** Whether `pageDraft` came from the filename rather than a person. */
  fromFileName: boolean;
  title: string;
}

function parsePageDraft(draft: string): number | null {
  if (!/^\d{3}$/.test(draft)) return null;
  return Number(draft);
}

/** The stencil, drawn large enough to read the character off. */
function GlyphStencil({ bitmap }: { bitmap: boolean[][] }) {
  // Sized from the stencil itself: cells are 13x16, 10x12 or 8x10 depending on
  // which of the archive's renderers produced the page.
  const width = bitmap[0]?.length ?? 0;
  const height = bitmap.length;
  return (
    <svg
      className="import-glyph-stencil"
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Unrecognised character stencil"
    >
      <rect width={width} height={height} fill="#000" />
      {bitmap.flatMap((row, y) =>
        row.map((ink, x) =>
          ink ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="#fff" /> : null,
        ),
      )}
    </svg>
  );
}

/**
 * The capture a card is showing, in words — "screen 2 · 6 Jun 2001" — or
 * `null` when the filename carried neither, in which case the card falls back
 * to showing the filename itself.
 */
function describeCapture(info: ArchiveFileInfo): string | null {
  const parts: string[] = [];
  if (info.subpage != null && info.subpage > 1) parts.push(`screen ${info.subpage}`);
  if (info.capturedAt != null && info.capturedAt.length >= 8) {
    const year = info.capturedAt.slice(0, 4);
    const month = info.capturedAt.slice(4, 6);
    const day = info.capturedAt.slice(6, 8);
    parts.push(`${day}/${month}/${year}`);
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

/**
 * How many unrecognised stencils to list at once. A batch pulled straight from
 * an archive can turn up a couple of hundred — every character the atlas has
 * not been taught, plus every half of every double-height line — and a list
 * that long is not a task anyone can start. Showing the most-used first makes
 * it one: they are the ordinary letters, and answering them is what reveals
 * whether the rest are worth the trouble.
 */
const SHOWN_GLYPH_LIMIT = 24;

/** Status word shown on a card, keyed off the issue's severity. */
function issueTone(issue: EntryIssue | null): string {
  if (issue == null) return 'ok';
  return blocksImport(issue) ? 'blocked' : 'warn';
}

export function ImportArchivePage() {
  const navigate = useNavigate();
  const isModerator = useIsModerator();
  const { importPages, saveError } = useImportPages();
  const { setTitle } = usePageTitles();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [renumberFrom, setRenumberFrom] = useState(String(PLAYGROUND_MIN_PAGE));
  /** Files waiting on the "which capture of each page?" question. */
  const [pending, setPending] = useState<File[] | null>(null);

  // Shared across machines, cached locally. Keys from different render sizes
  // are different lengths, so one flat map of taught characters can be handed
  // to any profile without them colliding.
  const { glyphs: learnedGlyphs, teach, syncError: glyphSyncError } = useLearnedGlyphs();
  const atlas = learnedGlyphs;

  // Object URLs outlive React's render cycle, so they're released from a ref
  // that always holds the current set rather than from an effect per entry.
  const objectUrlsRef = useRef<Set<string>>(new Set());
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
    },
    [],
  );

  /**
   * Decode `files` onto the sheet, in flushes rather than all at the end, so a
   * few hundred renders fill the sheet as they are read instead of showing
   * nothing until the last one lands. Flushed in groups because one setState
   * per file would re-render every card already on the sheet, once per file.
   */
  const decodeFiles = useCallback(
    async (files: readonly File[]) => {
      setImported(null);
      setReading({ done: 0, total: files.length });

      const FLUSH_EVERY = 12;
      let added: Entry[] = [];
      const flush = () => {
        if (added.length === 0) return;
        const batch = added;
        added = [];
        setEntries((previous) => [...previous, ...batch]);
      };

      for (const [i, file] of files.entries()) {
        const objectUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(objectUrl);
        const info = parseArchiveFileName(file.name);
        const base: Entry = {
          id: `${file.name}:${file.size}:${file.lastModified}:${i}:${Date.now()}`,
          fileName: file.name,
          objectUrl,
          file,
          info,
          result: null,
          unreadable: null,
          pageDraft: info.pageNumber == null ? '' : String(info.pageNumber),
          fromFileName: info.pageNumber != null,
          title: '',
        };
        try {
          const pixels = await loadArchiveImage(file);
          added.push({ ...base, result: importArchiveImage(pixels, atlas) });
        } catch (err) {
          added.push({
            ...base,
            unreadable: err instanceof Error ? err.message : 'Could not read that image.',
          });
        }
        setReading({ done: i + 1, total: files.length });
        if (added.length >= FLUSH_EVERY) {
          flush();
          // Yield so the newly-added cards and the progress count actually
          // paint before the next file is read.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      flush();
      setReading(null);
    },
    [atlas],
  );

  /**
   * Take in dropped files. An archive dump holds the same page many times over
   * — one render per capture, and another per screen of a multi-screen story —
   * so a folder of 2,000 files is usually a few hundred pages. Deciding that
   * *before* decoding matters: it is the difference between reading 400 images
   * and 2,000, and the answer is in the filenames, which cost nothing to read.
   */
  const addFiles = useCallback(
    (files: readonly File[]) => {
      const images = files.filter((file) => /\.(gif|png)$/i.test(file.name));
      if (images.length === 0) return;

      const keep = chooseOnePerPage(
        images.map((file, i) => ({ id: String(i), info: parseArchiveFileName(file.name) })),
        'newest',
      );
      if (keep.size < images.length) {
        setPending(images);
        return;
      }
      void decodeFiles(images);
    },
    [decodeFiles],
  );

  /** Resolve the "this folder repeats itself" question with one of its answers. */
  const resolvePending = useCallback(
    (prefer: 'newest' | 'oldest' | 'all') => {
      const files = pending;
      setPending(null);
      if (files == null) return;
      if (prefer === 'all') {
        void decodeFiles(files);
        return;
      }
      const keep = chooseOnePerPage(
        files.map((file, i) => ({ id: String(i), info: parseArchiveFileName(file.name) })),
        prefer,
      );
      void decodeFiles(files.filter((_, i) => keep.has(String(i))));
    },
    [pending, decodeFiles],
  );

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      addFiles([...(e.target.files ?? [])]);
      // Let the same files be chosen again after being removed from the sheet.
      e.target.value = '';
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      addFiles([...e.dataTransfer.files]);
    },
    [addFiles],
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((previous) => {
      const going = previous.find((entry) => entry.id === id);
      if (going != null) {
        URL.revokeObjectURL(going.objectUrl);
        objectUrlsRef.current.delete(going.objectUrl);
      }
      return previous.filter((entry) => entry.id !== id);
    });
    setInspectingId((current) => (current === id ? null : current));
  }, []);

  const clearAll = useCallback(() => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
    setEntries([]);
    setInspectingId(null);
    setImported(null);
  }, []);

  const setPageDraft = useCallback((id: string, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, pageDraft: cleaned, fromFileName: false } : entry,
      ),
    );
    setImported(null);
  }, []);

  const setEntryTitle = useCallback((id: string, value: string) => {
    setEntries((previous) =>
      previous.map((entry) => (entry.id === id ? { ...entry, title: value } : entry)),
    );
  }, []);

  const handleRenumber = useCallback(() => {
    const start = parsePageDraft(renumberFrom);
    if (start == null) return;
    setEntries((previous) => {
      const numbers = sequentialPageNumbers(previous.length, start);
      return previous.map((entry, i) => ({
        ...entry,
        pageDraft: numbers[i] == null ? '' : String(numbers[i]),
        fromFileName: false,
      }));
    });
    setImported(null);
  }, [renumberFrom]);

  /**
   * Record what a stencil draws, then re-decode with it — but only the pages
   * that actually contain that stencil, which is what keeps teaching quick on
   * a batch of hundreds.
   */
  const teachGlyph = useCallback(
    (key: string, char: string) => {
      const next = { ...learnedGlyphs };
      if (char.length === 0) delete next[key];
      else next[key] = char;
      // Shares it with every other machine; applies locally straight away so
      // the re-decode below sees it.
      teach(key, char);
      setImported(null);

      const merged = next;
      const affected = entries.filter((entry) =>
        entry.result?.unknownGlyphs.some((glyph) => glyph.key === key),
      );

      void (async () => {
        for (const entry of affected) {
          try {
            const pixels = await loadArchiveImage(entry.file);
            const result = importArchiveImage(pixels, merged);
            setEntries((current) =>
              current.map((e) => (e.id === entry.id ? { ...e, result } : e)),
            );
          } catch {
            // The file read fine once already; if it suddenly won't, leave the
            // entry exactly as it was rather than blanking a good decode.
          }
        }
      })();
    },
    [entries, learnedGlyphs, teach],
  );

  const duplicates = useMemo(
    () => duplicatePageNumbers(entries.map((entry) => parsePageDraft(entry.pageDraft))),
    [entries],
  );

  const issues = useMemo(() => {
    const map = new Map<string, EntryIssue | null>();
    for (const entry of entries) {
      const pageNumber = parsePageDraft(entry.pageDraft);
      map.set(
        entry.id,
        entryIssue({
          unreadable: entry.unreadable,
          pageNumber,
          duplicate: pageNumber != null && duplicates.has(pageNumber),
          isModerator,
          unknownCells:
            entry.result?.unknownGlyphs.reduce((n, g) => n + g.cells.length, 0) ?? 0,
        }),
      );
    }
    return map;
  }, [entries, duplicates, isModerator]);

  /** Unrecognised stencils across the whole batch, most-used first. */
  const unknownGlyphs = useMemo(() => {
    const pooled = new Map<string, { bitmap: boolean[][]; cells: number; pages: number }>();
    for (const entry of entries) {
      for (const glyph of entry.result?.unknownGlyphs ?? []) {
        const seen = pooled.get(glyph.key);
        if (seen == null) {
          pooled.set(glyph.key, { bitmap: glyph.bitmap, cells: glyph.cells.length, pages: 1 });
        } else {
          seen.cells += glyph.cells.length;
          seen.pages += 1;
        }
      }
    }
    return [...pooled.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.cells - a.cells);
  }, [entries]);

  const ready = entries.filter((entry) => !blocksImport(issues.get(entry.id) ?? null));

  const handleImport = useCallback(() => {
    const writable = ready.flatMap((entry) => {
      const pageNumber = parsePageDraft(entry.pageDraft);
      return pageNumber != null && entry.result != null
        ? [{ pageNumber, page: entry.result.page, title: entry.title }]
        : [];
    });
    const written = importPages(writable);
    for (const { pageNumber, title } of writable) {
      if (title.trim().length > 0) setTitle(pageNumber, title);
    }
    setImported(written);
  }, [ready, importPages, setTitle]);

  /** Taught characters the checked-in atlas does not have yet. */
  const newGlyphs = useMemo(
    () =>
      Object.entries(learnedGlyphs).filter(
        ([key]) => !RENDER_PROFILES.some((profile) => profile.atlas[key] != null),
      ),
    [learnedGlyphs],
  );

  const [copied, setCopied] = useState(false);
  const handleCopyGlyphs = useCallback(() => {
    const source = newGlyphs
      .map(([key, char]) => `  '${key}': '${char === "'" ? "\\'" : char}',`)
      .join('\n');
    void navigator.clipboard.writeText(source).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }, [newGlyphs]);

  const inspecting = entries.find((entry) => entry.id === inspectingId) ?? null;

  return (
    <div className="editor-layout">
      <aside className="editor-sidebar">
        <h1 className="editor-title">IMPORT ARCHIVE PAGES</h1>

        <Link to="/" className="sidebar-back-link">
          &lt; Back to home
        </Link>

        <section className="sidebar-section">
          <h2 className="sidebar-heading">Renders</h2>
          <p className="sidebar-hint">
            GIFs straight from the archive’s renderer — {acceptedSizes()}, or a whole
            multiple of one. Drop as many as you like; each one’s page number is read from
            its filename. A screenshot won’t work: resizing blurs the pixel grid this reads.
          </p>
          <div className="sidebar-field">
            <label className="sidebar-field-label" htmlFor="import-file-input">
              Choose files
            </label>
            <input
              id="import-file-input"
              type="file"
              accept="image/gif,image/png"
              multiple
              className="sidebar-input"
              disabled={reading != null}
              onChange={handleFileInput}
            />
            {reading != null && (
              <p className="sidebar-hint" role="status">
                Reading… {reading.done}/{reading.total}
              </p>
            )}
          </div>
          {entries.length > 0 && (
            <button type="button" className="sidebar-action-btn" onClick={clearAll}>
              Remove all {entries.length}
            </button>
          )}
        </section>

        {pending != null && (
          <section className="sidebar-section import-pending">
            <h2 className="sidebar-heading">That folder repeats itself</h2>
            <p className="sidebar-hint">
              {pending.length} files, but only{' '}
              {new Set(
                pending
                  .map((file) => parseArchiveFileName(file.name).pageNumber)
                  .filter((n) => n != null),
              ).size}{' '}
              page numbers between them — the archive keeps every capture of a page, and a
              separate render for each screen of a longer story. Which do you want?
            </p>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => resolvePending('newest')}
            >
              Newest capture of each page
            </button>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => resolvePending('oldest')}
            >
              Oldest capture of each page
            </button>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => resolvePending('all')}
            >
              All {pending.length} — I'll sort the clashes out
            </button>
          </section>
        )}

        {entries.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-heading">Page numbers</h2>
            <p className="sidebar-hint">
              Read from each filename. Override any of them on its card — or, if the archive
              range isn’t yours to write, put the whole batch somewhere it is:
            </p>
            <div className="import-renumber-row">
              <label className="sidebar-field-label" htmlFor="import-renumber">
                Renumber all from
              </label>
              <input
                id="import-renumber"
                type="text"
                inputMode="numeric"
                className="sidebar-input import-renumber-input"
                value={renumberFrom}
                onChange={(e) => setRenumberFrom(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
              <button
                type="button"
                className="sidebar-action-btn"
                disabled={parsePageDraft(renumberFrom) == null}
                onClick={handleRenumber}
              >
                Apply
              </button>
            </div>
          </section>
        )}

        {unknownGlyphs.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-heading">Unrecognised characters</h2>
            <p className="sidebar-hint">
              Pooled across every render here, so each shape is one answer no matter how many
              pages use it. Type what it draws and they all re-read themselves.
              {unknownGlyphs.length > SHOWN_GLYPH_LIMIT && (
                <>
                  {' '}The {SHOWN_GLYPH_LIMIT} most-used are listed; the other{' '}
                  {unknownGlyphs.length - SHOWN_GLYPH_LIMIT} appear as these are answered.
                </>
              )}
            </p>
            <ul className="import-glyph-list">
              {unknownGlyphs.slice(0, SHOWN_GLYPH_LIMIT).map((glyph) => (
                <li key={glyph.key} className="import-glyph-item">
                  <GlyphStencil bitmap={glyph.bitmap} />
                  <div className="import-glyph-fields">
                    <input
                      type="text"
                      className="sidebar-input import-glyph-input"
                      maxLength={2}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`Character for the stencil used ${glyph.cells} times`}
                      defaultValue={learnedGlyphs[glyph.key] ?? ''}
                      onChange={(e) => teachGlyph(glyph.key, e.target.value)}
                    />
                    <span className="sidebar-hint">
                      {glyph.cells}× on {glyph.pages} page{glyph.pages === 1 ? '' : 's'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {newGlyphs.length > 0 && (
          <section className="sidebar-section">
            <h2 className="sidebar-heading">Taught characters</h2>
            <p className="sidebar-hint">
              {newGlyphs.length} taught in this browser: {newGlyphs.map(([, c]) => c).join(' ')}.
              Paste them into <code>domain/data/glyphAtlas.ts</code> to keep them for good.
            </p>
            <button type="button" className="sidebar-action-btn" onClick={handleCopyGlyphs}>
              {copied ? 'Copied' : 'Copy for glyphAtlas.ts'}
            </button>
          </section>
        )}

        <section className="sidebar-section sidebar-actions">
          <button
            type="button"
            className="sidebar-action-btn"
            disabled={ready.length === 0 || reading != null}
            onClick={handleImport}
          >
            Import {ready.length} page{ready.length === 1 ? '' : 's'}
          </button>
          {entries.length > ready.length && (
            <p className="sidebar-hint">
              {entries.length - ready.length} of {entries.length} can’t be imported yet — see
              the cards marked in red.
            </p>
          )}
          {saveError != null && (
            <p className="sidebar-error" role="alert">
              {saveError}
            </p>
          )}
          {glyphSyncError != null && (
            // Taught characters still work here; they just have not reached the
            // shared atlas, so another machine would have to be taught again.
            <p className="sidebar-hint" role="status">
              {glyphSyncError}
            </p>
          )}
          {imported != null && saveError == null && (
            <>
              <p className="sidebar-hint" role="status">
                Imported {imported} page{imported === 1 ? '' : 's'}.
              </p>
              <button
                type="button"
                className="sidebar-action-btn"
                onClick={() => navigate('/watch')}
              >
                Go watch them
              </button>
            </>
          )}
        </section>
      </aside>

      {inspecting != null ? (
        <div className="editor-main import-dual-pane">
          <div className="import-inspect-bar">
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={() => setInspectingId(null)}
            >
              &lt; Back to all {entries.length}
            </button>
            <span className="import-pane-label">{inspecting.fileName}</span>
            <input
              type="text"
              className="sidebar-input import-inspect-title"
              placeholder="Title (optional)"
              value={inspecting.title}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setEntryTitle(inspecting.id, e.target.value)}
            />
          </div>
          <div className="import-inspect-panes">
            <div className="import-pane">
              <span className="import-pane-label">Source</span>
              <img
                className="import-source-image"
                src={inspecting.objectUrl}
                alt={inspecting.fileName}
              />
            </div>
            <div className="import-pane">
              <span className="import-pane-label">Result</span>
              <TeletextGrid
                page={inspecting.result?.page ?? createEmptyPage()}
                pageNumber={parsePageDraft(inspecting.pageDraft) ?? PLAYGROUND_MIN_PAGE}
                readOnly
              />
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`editor-main import-sheet${dragActive ? ' import-sheet-drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          {entries.length === 0 ? (
            <p className="import-empty">
              Drop archive GIFs here — a whole folder at a time is fine.
              <br />
              Each file’s page number comes from its name, so <code>163-01.gif</code> lands on
              page 163.
            </p>
          ) : (
            <ul className="import-card-grid">
              {entries.map((entry) => {
                const issue = issues.get(entry.id) ?? null;
                return (
                  <li key={entry.id} className={`import-card import-card-${issueTone(issue)}`}>
                    <div className="import-card-head">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="import-card-page"
                        value={entry.pageDraft}
                        placeholder="—"
                        aria-label={`Page number for ${entry.fileName}`}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setPageDraft(entry.id, e.target.value)}
                      />
                      {entry.fromFileName && (
                        <span className="import-card-derived" title="Read from the filename">
                          auto
                        </span>
                      )}
                      <button
                        type="button"
                        className="import-card-remove"
                        aria-label={`Remove ${entry.fileName}`}
                        onClick={() => removeEntry(entry.id)}
                      >
                        ×
                      </button>
                    </div>

                    <button
                      type="button"
                      className="import-card-thumb"
                      onClick={() => setInspectingId(entry.id)}
                      aria-label={`Inspect ${entry.fileName}`}
                    >
                      {entry.unreadable == null ? (
                        <img src={entry.objectUrl} alt="" />
                      ) : (
                        <span className="import-card-thumb-failed">unreadable</span>
                      )}
                    </button>

                    <span className="import-card-name" title={entry.fileName}>
                      {describeCapture(entry.info) ?? entry.fileName}
                    </span>
                    <span className="import-card-status">{describeIssue(issue)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default ImportArchivePage;
