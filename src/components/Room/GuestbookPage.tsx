import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useGuestbook } from '../../collab/useGuestbook';
import {
  SNIPPET_ROWS,
  createEmptySnippet,
  type GuestbookEntry,
} from '../../domain/guestbook';
import { DISPLAY_NAME_MAX } from '../../domain/identity';
import {
  TELETEXT_COLORS,
  type Cell,
  type TeletextColor,
  type TeletextPage,
} from '../../types/teletext';
import { TeletextThumbnail } from '../TeletextGrid/TeletextThumbnail';
import { SnippetGrid, type SnippetTool } from './SnippetGrid';
import { useCopy } from './useCopy';
import { useLanguage } from './useLanguage';

/**
 * GuestbookPage — the book of signatures, at `/guestbook`.
 *
 * Reached from the third word on the front page. A visitor leaves a name and a
 * snippet: eight rows of teletext, a third of a page, drawn under the same
 * rules the broadcasters had. The book is one shared list for the whole site
 * (`collab/useGuestbook.ts`), so a signature left here appears on everyone
 * else's screen as it lands.
 *
 * ## What the page is *for*
 *
 * Reading it. The signatures are the work, so they hold the middle of the page
 * on their own and the form is not there until it is asked for — a screen that
 * opens on an empty form beside an empty grid says "fill this in" when what it
 * should say is "look at these". Signing splits the page: the form takes a
 * column on the left and the book moves right, staying on screen while it is
 * being added to. Narrow, there are no columns to take, so the form opens below
 * the book instead.
 *
 * ## Why this screen has no language switch
 *
 * Unlike the about page, which is a wall label people arrive at from a link
 * with no front page behind them, this is a screen you *do* something on — and
 * the rule the rest of the app follows (see {@link useCopy}) is that the choice
 * is made once, on the front page, which is one click away up the back link.
 */
export function GuestbookPage() {
  const copy = useCopy();
  const { language } = useLanguage();
  const { entries, memberId, sign } = useGuestbook();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cells, setCells] = useState<TeletextPage>(createEmptySnippet);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [tool, setTool] = useState<SnippetTool>('text');
  const [fg, setFg] = useState<TeletextColor>('white');
  const [bg, setBg] = useState<TeletextColor>('black');
  const [notice, setNotice] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);

  // The form is below the book in the document, so that narrow screens read
  // book-then-form and the columns are a matter of placement rather than order.
  // That means opening it moves nothing the keyboard is on, hence this: the
  // caret goes to the first field, which is where a signer is looking anyway.
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  /**
   * Replace one cell.
   *
   * The cells that did not change keep their identity, which is what lets the
   * grid's cells be compared rather than rebuilt — the same reason the page
   * editor has `domain/pageReuse.ts`.
   */
  const handleCellChange = useCallback((index: number, cell: Cell) => {
    setCells((current) => {
      if (index < 0 || index >= current.length) return current;
      const next = current.slice();
      next[index] = cell;
      return next;
    });
    setNotice(null);
  }, []);

  const handleClear = useCallback(() => {
    setCells(createEmptySnippet());
    setCursorIndex(0);
    setNotice(null);
  }, []);

  const handleSign = useCallback(() => {
    const result = sign(name, cells);
    if (result.ok) {
      // The snippet goes, the name stays: signing twice is allowed, and
      // retyping your own name to do it would be a small insult.
      setCells(createEmptySnippet());
      setCursorIndex(0);
      setNotice(copy.guestbook.signed);
      return;
    }
    setNotice(
      result.reason === 'no-name'
        ? copy.guestbook.errorNoName
        : result.reason === 'name-too-long'
          ? copy.guestbook.errorNameTooLong(DISPLAY_NAME_MAX)
          : copy.guestbook.errorBlank,
    );
  }, [cells, copy.guestbook, name, sign]);

  return (
    <div className="guestbook">
      <header className="guestbook-head">
        <Link to="/" className="room-back-link" aria-label={copy.layout.backHome}>
          <span className="room-back-arrow" aria-hidden="true">
            &lt;
          </span>
          <img src="/logo.png" alt="" className="room-back-logo" />
        </Link>
      </header>

      <main className="guestbook-body" aria-label={copy.guestbook.region}>
        <div className="guestbook-masthead">
          <div>
            <h1 className="guestbook-title teletext-fg-yellow">{copy.guestbook.title}</h1>
            <p className="guestbook-intro">{copy.guestbook.intro}</p>
          </div>
          <button
            type="button"
            className="guestbook-open"
            aria-expanded={open}
            aria-controls="guestbook-sign"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? copy.guestbook.close : copy.guestbook.sign}
          </button>
        </div>

        <div className={`guestbook-layout${open ? ' guestbook-layout-open' : ''}`}>
          <section className="guestbook-list" aria-labelledby="guestbook-list-heading">
            <h2 id="guestbook-list-heading" className="guestbook-heading teletext-fg-cyan">
              {copy.guestbook.entries}
            </h2>

            {entries.length === 0 ? (
              <p className="guestbook-empty">{copy.guestbook.empty}</p>
            ) : (
              <ul className="guestbook-entries">
                {entries.map((entry) => (
                  <Entry
                    key={entry.id}
                    entry={entry}
                    mine={entry.authorId === memberId}
                    yoursLabel={copy.guestbook.yours}
                    signedBy={copy.guestbook.signedBy}
                    locale={language === 'pt' ? 'pt-PT' : 'en-GB'}
                  />
                ))}
              </ul>
            )}
          </section>

          {open && (
            <section
              className="guestbook-sign"
              id="guestbook-sign"
              aria-labelledby="guestbook-sign-heading"
            >
              <h2
                id="guestbook-sign-heading"
                className="guestbook-heading teletext-fg-green"
              >
                {copy.guestbook.sign}
              </h2>

              <label className="guestbook-field">
                <span className="guestbook-label">{copy.guestbook.yourName}</span>
                <input
                  ref={nameRef}
                  type="text"
                  className="guestbook-name"
                  value={name}
                  maxLength={DISPLAY_NAME_MAX}
                  placeholder={copy.guestbook.namePlaceholder}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNotice(null);
                  }}
                />
              </label>

              <div className="guestbook-tools">
                <fieldset className="guestbook-toolset">
                  <legend className="guestbook-label">{copy.guestbook.tool}</legend>
                  {(
                    [
                      ['text', copy.guestbook.toolText],
                      ['pixel', copy.guestbook.toolPixel],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`guestbook-tool${tool === value ? ' guestbook-tool-on' : ''}`}
                      aria-pressed={tool === value}
                      onClick={() => setTool(value)}
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>

                <Swatches
                  label={copy.guestbook.color}
                  value={fg}
                  onChange={setFg}
                  name="guestbook-fg"
                />
                {/*
                  * Only the text tool has a background.
                  *
                  * A pixel is one sixth of a cell in one colour; the other five
                  * sixths are the cell's own background, so offering a
                  * background picker beside the pixel tool would be offering a
                  * control that repaints the parts you did not click.
                  */}
                {tool === 'text' && (
                  <Swatches
                    label={copy.guestbook.background}
                    value={bg}
                    onChange={setBg}
                    name="guestbook-bg"
                  />
                )}
              </div>

              <SnippetGrid
                cells={cells}
                cursorIndex={cursorIndex}
                onCursorChange={setCursorIndex}
                onCellChange={handleCellChange}
                tool={tool}
                fg={fg}
                bg={bg}
                label={copy.guestbook.yourSnippet}
                hint={
                  tool === 'text' ? copy.guestbook.textHint : copy.guestbook.pixelHint
                }
                hintId="guestbook-snippet-hint"
              />

              <div className="guestbook-actions">
                <button type="button" className="guestbook-clear" onClick={handleClear}>
                  {copy.guestbook.clear}
                </button>
                <button type="button" className="guestbook-submit" onClick={handleSign}>
                  {copy.guestbook.submit}
                </button>
              </div>

              {/* Both the refusals and the thank-you land here, and both are
                  announced: a signature that silently did not happen is the
                  worst outcome this screen has. */}
              <p className="guestbook-notice" role="status">
                {notice ?? ''}
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

/** One signature: who left it, when, and the eight rows they drew. */
function Entry({
  entry,
  mine,
  yoursLabel,
  signedBy,
  locale,
}: {
  entry: GuestbookEntry;
  mine: boolean;
  yoursLabel: string;
  signedBy(name: string): string;
  locale: string;
}) {
  const when =
    entry.ts > 0
      ? new Date(entry.ts).toLocaleDateString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';

  return (
    <li className="guestbook-entry">
      <div className="guestbook-entry-head">
        <span className="guestbook-entry-name teletext-fg-white">{entry.name}</span>
        {mine && <span className="guestbook-entry-mine">{yoursLabel}</span>}
        {when !== '' && <time className="guestbook-entry-date">{when}</time>}
      </div>
      {/*
        * A picture, not a grid of elements. A signature is only looked at, and
        * a list of interactive 320-cell grids would be tens of thousands of
        * nodes on a page that grows every time somebody signs.
        */}
      <TeletextThumbnail
        page={entry.cells}
        pageNumber={0}
        rows={SNIPPET_ROWS}
        headerRow={false}
        showIndexLine={false}
        alt={signedBy(entry.name)}
      />
    </li>
  );
}

/** The eight colours, as a row of swatches. */
function Swatches({
  label,
  value,
  onChange,
  name,
}: {
  label: string;
  value: TeletextColor;
  onChange(color: TeletextColor): void;
  name: string;
}) {
  return (
    <fieldset className="guestbook-swatches">
      <legend className="guestbook-label">{label}</legend>
      {TELETEXT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`guestbook-swatch teletext-bg-${color}${
            value === color ? ' guestbook-swatch-on' : ''
          }`}
          aria-pressed={value === color}
          aria-label={`${label}: ${color}`}
          data-testid={`${name}-${color}`}
          onClick={() => onChange(color)}
        />
      ))}
    </fieldset>
  );
}

export default GuestbookPage;
