/**
 * The `/manage` tab that decides what the front page shows.
 *
 * The strip used to be whatever the live document held, in page order, which
 * is not a choice — it showed page 100 because 100 is the lowest number. Here a
 * moderator picks, and the order is theirs.
 *
 * Choosing a page draws it, once, in this browser, and uploads the picture. The
 * front page then serves an image rather than redrawing a dozen pages from
 * cells in every visitor's browser on every visit. The consequence to know
 * about: the picture is a snapshot. Editing a page afterwards does not update
 * the strip until someone refreshes it, which is what **Redraw** is for.
 */

import { useMemo, useState } from 'react';

import { showcaseImageUrl, type ShowcaseApi } from '../../collab/useShowcase';
import { isArchivePage } from '../../domain/access';

export interface ShowcasePanelProps {
  showcase: ShowcaseApi;
  /** Every page holding something, ascending. */
  occupiedPages: readonly number[];
  titleOf(pageNumber: number): string;
  subpageCountOfPage(pageNumber: number): number;
}

export function ShowcasePanel({
  showcase,
  occupiedPages,
  titleOf,
  subpageCountOfPage,
}: ShowcasePanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  /**
   * What may go on the strip: every screen of every curated page.
   *
   * The playground is excluded for the same reason the strip always excluded
   * it — 700+ is writable by any visitor, and the front page cannot be a
   * surface for whatever was typed there a minute ago.
   */
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
          term === '' ||
          String(pageNumber).includes(term) ||
          title.toLowerCase().includes(term),
      );
  }, [occupiedPages, subpageCountOfPage, titleOf, filter]);

  const run = async (
    key: string,
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
  ) => {
    setBusy(key);
    const result = await action();
    setBusy(null);
    setNotice(result.ok ? done : result.error);
  };

  return (
    <div className="manage-on-air">
      {notice != null && (
        <p className="manage-note" role="status">
          {notice}
        </p>
      )}

      <section className="manage-group" aria-label="On the front page">
        <h3 className="manage-group-title">
          On the front page ({showcase.entries.length})
        </h3>
        {showcase.error != null && (
          <p className="manage-note manage-note-error">{showcase.error}</p>
        )}
        {showcase.entries.length === 0 ? (
          <p className="landing-section-description">
            Nothing chosen yet — the front page shows no strip until a page is
            added here.
          </p>
        ) : (
          <ul className="manage-published-grid">
            {showcase.entries.map((entry) => {
              const key = `${entry.page_number}.${entry.subpage}`;
              return (
                <li key={key} className="manage-published-card">
                  {/* The stored picture, not a redraw — this is exactly what a
                      visitor sees, which is the point of showing it here. */}
                  <img
                    className="manage-showcase-image"
                    src={showcaseImageUrl(entry.page_number, entry.subpage)}
                    alt={`Page ${entry.page_number}`}
                    loading="lazy"
                  />
                  <div className="manage-published-meta">
                    <strong className="manage-card-number">
                      {entry.page_number}
                      {entry.subpage > 1 ? `-${entry.subpage}` : ''}
                    </strong>
                    <span className="manage-card-title">
                      {entry.title || <em>untitled</em>}
                    </span>
                    <span className="manage-note">
                      Drawn {entry.updated_at.slice(0, 10)}
                    </span>
                    <div className="manage-card-actions">
                      <button
                        type="button"
                        className="manage-mini-btn"
                        disabled={busy != null}
                        // The picture is a snapshot; editing the page since does
                        // not change it, so there has to be a way to say "again".
                        title="Draw this page again as it looks now"
                        onClick={() =>
                          void run(
                            key,
                            () =>
                              showcase.add(
                                entry.page_number,
                                entry.subpage,
                                entry.position,
                              ),
                            `Page ${entry.page_number} redrawn.`,
                          )
                        }
                      >
                        {busy === key ? 'Drawing…' : 'Redraw'}
                      </button>
                      <button
                        type="button"
                        className="manage-mini-btn manage-mini-btn-danger"
                        disabled={busy != null}
                        onClick={() =>
                          void run(
                            key,
                            () => showcase.remove(entry.page_number, entry.subpage),
                            `Page ${entry.page_number} taken off the front page.`,
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="manage-group" aria-label="Pages you can add">
        <h3 className="manage-group-title">Add a page</h3>
        <div className="manage-filters" role="search">
          <span className="manage-reorder-field">
            <label className="sidebar-field-label" htmlFor="showcase-filter">
              Find a page
            </label>
            <input
              id="showcase-filter"
              type="search"
              className="landing-name-input"
              placeholder="number or title"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </span>
        </div>

        <ul className="manage-showcase-choices">
          {candidates.map(({ pageNumber, subpage, title }) => {
            const key = `${pageNumber}.${subpage}`;
            const on = showcase.has(pageNumber, subpage);
            return (
              <li key={key} className="manage-showcase-choice">
                <span className="manage-card-number">
                  {pageNumber}
                  {subpage > 1 ? `-${subpage}` : ''}
                </span>
                <span className="manage-card-title">{title || <em>untitled</em>}</span>
                <button
                  type="button"
                  className="manage-mini-btn"
                  disabled={busy != null || on}
                  title={
                    on
                      ? 'Already on the front page'
                      : 'Draw this page now and put it on the front page'
                  }
                  onClick={() =>
                    void run(
                      key,
                      () =>
                        showcase.add(pageNumber, subpage, showcase.entries.length),
                      `Page ${pageNumber} added to the front page.`,
                    )
                  }
                >
                  {busy === key ? 'Drawing…' : on ? 'On air' : '+ Add'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default ShowcasePanel;
