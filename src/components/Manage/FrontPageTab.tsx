/**
 * What the front page's strip shows, and in what order.
 *
 * Choosing a screen draws it once, here, and uploads the picture; the front
 * page then serves an image rather than redrawing a dozen pages from cells for
 * every visitor. So the picture is a snapshot — editing the page afterwards
 * does not change it until it is redrawn, which is what **Redraw** is for.
 *
 * The playground is never offered: 700+ is writable by anyone, and the front
 * page cannot be a surface for whatever was typed there a minute ago.
 */

import { useMemo, useState } from 'react';

import { showcaseImageUrl, type ShowcaseApi } from '../../collab/useShowcase';
import { isArchivePage } from '../../domain/access';
import type { Notice } from '../../domain/manageMessages';

export interface FrontPageTabProps {
  showcase: ShowcaseApi;
  occupiedPages: readonly number[];
  titleOf(pageNumber: number): string;
  subpageCountOfPage(pageNumber: number): number;
  onNotice(notice: Notice): void;
}

type Result = { ok: true } | { ok: false; error: string };

export function FrontPageTab({
  showcase,
  occupiedPages,
  titleOf,
  subpageCountOfPage,
  onNotice,
}: FrontPageTabProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const candidates = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return occupiedPages
      .filter(isArchivePage)
      .flatMap((pageNumber) =>
        Array.from({ length: subpageCountOfPage(pageNumber) }, (_, i) => ({
          pageNumber,
          subpage: i + 1,
          title: titleOf(pageNumber),
        })),
      )
      .filter(
        ({ pageNumber, title }) =>
          term === '' || String(pageNumber).includes(term) || title.toLowerCase().includes(term),
      );
  }, [occupiedPages, subpageCountOfPage, titleOf, filter]);

  const run = async (key: string, action: () => Promise<Result>, done: string) => {
    setBusy(key);
    const result = await action();
    setBusy(null);
    onNotice(result.ok ? { tone: 'status', text: done } : { tone: 'alert', text: result.error });
  };

  const label = (pageNumber: number, subpage: number) =>
    subpage > 1 ? `${pageNumber}/${subpage}` : String(pageNumber);

  return (
    <div className="mg-front">
      <section className="mg-front-strip" aria-label="On the front page">
        <div className="mg-toolbar">
          <h2 className="mg-h2">On the front page</h2>
          <span className="mg-muted">
            {showcase.loading ? 'Loading…' : `${showcase.entries.length} screens, in this order`}
          </span>
        </div>
        {showcase.error != null && <p className="mg-banner">{showcase.error}</p>}
        {!showcase.loading && showcase.entries.length === 0 ? (
          <p className="mg-empty">Nothing chosen yet — the front page shows no strip until a screen is added.</p>
        ) : (
          <ol className="mg-front-grid">
            {showcase.entries.map((entry) => {
              const key = `${entry.page_number}.${entry.subpage}`;
              return (
                <li key={key} className="mg-front-card">
                  {/* The stored picture, not a redraw — exactly what a visitor sees. */}
                  <img
                    src={showcaseImageUrl(entry.page_number, entry.subpage, entry.updated_at)}
                    alt={`Page ${label(entry.page_number, entry.subpage)}`}
                    loading="lazy"
                  />
                  <div className="mg-front-meta">
                    <span className="mg-num">{label(entry.page_number, entry.subpage)}</span>
                    <span className="mg-ellipsis">{entry.title || <em className="mg-muted">Untitled</em>}</span>
                  </div>
                  <div className="mg-inline">
                    <span className="mg-muted mg-grow">Drawn {entry.updated_at.slice(0, 10)}</span>
                    <button
                      type="button"
                      className="mg-btn mg-btn-small"
                      disabled={busy != null}
                      title="Draw it again as it looks now"
                      onClick={() =>
                        void run(
                          key,
                          () => showcase.add(entry.page_number, entry.subpage, entry.position),
                          `Page ${label(entry.page_number, entry.subpage)} redrawn.`,
                        )
                      }
                    >
                      {busy === key ? 'Drawing…' : 'Redraw'}
                    </button>
                    <button
                      type="button"
                      className="mg-btn mg-btn-small mg-btn-danger-ghost"
                      disabled={busy != null}
                      onClick={() =>
                        void run(
                          key,
                          () => showcase.remove(entry.page_number, entry.subpage),
                          `Page ${label(entry.page_number, entry.subpage)} taken off the front page.`,
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="mg-front-add" aria-label="Screens you can add">
        <div className="mg-toolbar">
          <h2 className="mg-h2">Add a screen</h2>
          <input
            type="search"
            className="mg-input mg-grow"
            aria-label="Find a page"
            placeholder="Number or title"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <ul className="mg-front-choices">
          {candidates.map(({ pageNumber, subpage, title }) => {
            const key = `${pageNumber}.${subpage}`;
            const on = showcase.has(pageNumber, subpage);
            return (
              <li key={key} className="mg-front-choice">
                <span className="mg-num">{label(pageNumber, subpage)}</span>
                <span className="mg-ellipsis mg-grow">{title || <em className="mg-muted">Untitled</em>}</span>
                <button
                  type="button"
                  className="mg-btn mg-btn-small"
                  disabled={busy != null || on}
                  onClick={() =>
                    void run(
                      key,
                      () => showcase.add(pageNumber, subpage, showcase.entries.length),
                      `Page ${label(pageNumber, subpage)} added to the front page.`,
                    )
                  }
                >
                  {busy === key ? 'Drawing…' : on ? '★ On it' : '+ Add'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
