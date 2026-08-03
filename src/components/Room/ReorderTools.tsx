/**
 * Renumbering: making room, closing a gap, moving a section.
 *
 * Page numbers are positions, not names, so putting a new page between 204 and
 * 205 means moving 205 and everything above it. These three controls are how
 * that is said out loud, and each one renumbers every page it affects and
 * carries its content with it.
 *
 * ## They cover 100–999, and the server decides the rest
 *
 * Not 100–699. `MAX_ORDERABLE_PAGE` is 999 and `api/reorder.ts` plans over every
 * occupied page — it has to, or a shift would move a page onto a hand-made one
 * and destroy it. The single restriction is that a page published from the
 * archive may not land at 700 or above, where any visitor could edit it, and the
 * server refuses that with a reason naming the pages involved. Restating the
 * rule here would give it two definitions and one of them would drift.
 *
 * ## Its own busy state, not the screen's
 *
 * A renumbering in flight disables the renumbering controls. It does not disable
 * the cards, and a card's action does not disable it.
 */

import { useCallback, useState } from 'react';

import { blockMoved, roomMade, type Notice } from '../../domain/manageMessages';
import { MAX_ORDERABLE_PAGE, MIN_ORDERABLE_PAGE } from '../../domain/reorder';

type Outcome = { ok: true } | { ok: false; error: string };

export interface ReorderToolsProps {
  onShift(fromPage: number, delta: number): Promise<Outcome>;
  onMove(start: number, end: number, destination: number): Promise<Outcome>;
  onNotice(notice: Notice): void;
}

export function ReorderTools({ onShift, onMove, onNotice }: ReorderToolsProps) {
  const [roomAt, setRoomAt] = useState('');
  const [roomCount, setRoomCount] = useState('1');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (action: () => Promise<Outcome>, success: Notice) => {
      setPending(true);
      try {
        const result = await action();
        onNotice(result.ok ? success : { tone: 'alert', text: result.error });
      } catch (error) {
        onNotice({
          tone: 'alert',
          text:
            error instanceof Error
              ? error.message
              : 'The renumbering did not complete.',
        });
      } finally {
        // Always cleared. A rejection that left this true used to disable the
        // only button that could have retried it.
        setPending(false);
      }
    },
    [onNotice],
  );

  const roomReady = roomAt !== '' && roomCount !== '';
  const blockReady = blockStart !== '' && blockEnd !== '' && blockTo !== '';

  return (
    <div className="manage-reorder-tools">
      <p className="manage-note">
        Page numbers are positions. <strong>Make room</strong> opens a gap before a
        run, <strong>Move block</strong> relocates a whole section, and each one
        carries the content of every page it renumbers — hand-made pages and
        playground pages included. A page published from the archive will not be
        moved to 700 or above, where any visitor could edit it.
      </p>

      <div className="manage-reorder">
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-room-at">
            Make room at page
          </label>
          <input
            id="manage-room-at"
            type="number"
            min={MIN_ORDERABLE_PAGE}
            max={MAX_ORDERABLE_PAGE}
            value={roomAt}
            onChange={(e) => setRoomAt(e.target.value)}
          />
        </span>
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-room-count">
            for
          </label>
          <input
            id="manage-room-count"
            type="number"
            min={1}
            max={100}
            value={roomCount}
            onChange={(e) => setRoomCount(e.target.value)}
          />
        </span>
        <button
          type="button"
          className="manage-mini-btn"
          disabled={pending || !roomReady}
          onClick={() =>
            void run(
              () => onShift(Number(roomAt), Number(roomCount)),
              roomMade(Number(roomAt), Number(roomCount)),
            )
          }
        >
          Make room
        </button>
        <button
          type="button"
          className="manage-mini-btn"
          disabled={pending || !roomReady}
          onClick={() =>
            void run(
              () => onShift(Number(roomAt), -Number(roomCount)),
              roomMade(Number(roomAt), -Number(roomCount)),
            )
          }
        >
          Close gap
        </button>
      </div>

      <div className="manage-reorder">
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-block-start">
            Move pages
          </label>
          <input
            id="manage-block-start"
            type="number"
            min={MIN_ORDERABLE_PAGE}
            max={MAX_ORDERABLE_PAGE}
            placeholder="from"
            value={blockStart}
            onChange={(e) => setBlockStart(e.target.value)}
          />
        </span>
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-block-end">
            to
          </label>
          <input
            id="manage-block-end"
            type="number"
            min={MIN_ORDERABLE_PAGE}
            max={MAX_ORDERABLE_PAGE}
            placeholder="to"
            value={blockEnd}
            onChange={(e) => setBlockEnd(e.target.value)}
          />
        </span>
        <span className="manage-reorder-field">
          <label className="sidebar-field-label" htmlFor="manage-block-to">
            so they start at
          </label>
          <input
            id="manage-block-to"
            type="number"
            min={MIN_ORDERABLE_PAGE}
            max={MAX_ORDERABLE_PAGE}
            placeholder="page"
            value={blockTo}
            onChange={(e) => setBlockTo(e.target.value)}
          />
        </span>
        <button
          type="button"
          className="manage-mini-btn"
          disabled={pending || !blockReady}
          onClick={() =>
            void run(
              () => onMove(Number(blockStart), Number(blockEnd), Number(blockTo)),
              blockMoved(Number(blockStart), Number(blockEnd), Number(blockTo)),
            )
          }
        >
          {pending ? 'Moving…' : 'Move block'}
        </button>
      </div>
    </div>
  );
}
