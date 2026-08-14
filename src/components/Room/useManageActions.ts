/**
 * Starting an action on `/manage`, and reporting how it went.
 *
 * There used to be one `busy` boolean and one `notice` string for the whole
 * screen: a publish in flight disabled every nudge arrow, every reorder button,
 * unpublish and delete on every card, and a failure was announced through the
 * same `role="status"` as a success. Worse, any rejection left the flag stuck
 * `true`, which disabled the button that would have retried.
 *
 * Everything here follows from `runAction` being the only way in. Admission, the
 * disabled state, the notice, the per-card outcome and the confirmation are
 * decided in one place, so a new action cannot forget one of them.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { ArchiveAdminApi, PublishTransforms } from '../../collab/useArchiveAdmin';
import type { PageKind } from '../../domain/directory';
import {
  EMPTY_REGISTRY,
  beginAction,
  inFlightView,
  isRunning,
  settleAction,
  type ActionScope,
  type InFlightRegistry,
  type InFlightView,
  type PageActionName,
} from '../../domain/inFlight';
import {
  batchPublished,
  blockMoved,
  pageActionFailed,
  pageActionSucceeded,
  publishFailed,
  publishSucceeded,
  roleChanged,
  textTooLong,
  transformsApplied,
  type ConfirmRequest,
  type Notice,
} from '../../domain/manageMessages';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';

type Outcome = { ok: true } | { ok: false; error: string };

export interface ManageActionsInput {
  data: ArchiveAdminApi;
  setKind(pageNumber: number, kind: PageKind): void;
  /** Called once a page's text has been stored, so the editor can close. */
  onTextSaved(pageNumber: number): void;
  /**
   * Called once a page has been renumbered, so the move control can close. The
   * card under that number is a different page afterwards, so leaving the field
   * open would aim it at something the operator did not choose.
   */
  onMoved(): void;
  /** Called once a page has been folded in, so the chooser can close. */
  onAbsorbed(): void;
  /**
   * The notice line, for the case where a confirmation's opening control has gone
   * with the page it deleted. Owned by the shell, which renders it — a ref handed
   * back out of a hook makes every read of that hook's result look like a ref
   * access, which is not what the rest of this object is.
   */
  noticeRef: React.RefObject<HTMLDivElement | null>;
}

export interface PublishInput {
  pageNumber: number;
  /** Screen of the page's carousel, defaulting to the first. */
  subpage?: number;
  captureId: number;
  title: string;
  description: string;
  transforms: PublishTransforms;
  /**
   * Directory role to give the page once it is on air, or `undefined` to leave
   * whatever it already has — which is what a re-publish that only changes the
   * transforms wants.
   */
  kind?: PageKind;
}

/** One capture in a run, with the title it should carry. */
export interface BatchItem {
  id: number;
  title: string;
}

export interface ManageActionsApi {
  notice: Notice | null;
  setNotice(notice: Notice | null): void;
  inFlight: InFlightView;
  /** How each page's last settled action went. */
  outcomes: ReadonlyMap<number, Notice>;
  confirming: ConfirmRequest | null;
  askConfirm(request: ConfirmRequest): void;
  closeConfirm(): void;
  confirmAction(): void;
  nudge(pageNumber: number, delta: -1 | 1): void;
  /** Give a page one more screen. */
  addSubpage(pageNumber: number): void;
  /** Take a page's last screen away, with its publication record. */
  removeLastSubpage(pageNumber: number): void;
  /** Fold `source`'s carousel onto the end of `target`'s, emptying `source`. */
  absorbPage(target: number, source: number): void;
  /** Send a page to a page number the operator chose. */
  moveTo(pageNumber: number, destination: number): void;
  setRole(pageNumber: number, kind: PageKind): void;
  saveText(pageNumber: number, title: string, description: string): void;
  publish(input: PublishInput): void;
  /** Publish a run of captures onto consecutive pages from `startPage`. */
  publishBatch(
    items: readonly BatchItem[],
    startPage: number,
    kind: PageKind,
  ): void;
  /** Re-publish pages that already have records, to change their transforms. */
  republish(items: readonly PublishInput[]): void;
}

export function useManageActions({
  data,
  setKind,
  onTextSaved,
  onMoved,
  onAbsorbed,
  noticeRef,
}: ManageActionsInput): ManageActionsApi {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registry, setRegistry] = useState<InFlightRegistry>(EMPTY_REGISTRY);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, Notice>>(new Map());
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);

  /** The control that opened the confirmation, so focus can go back to it. */
  const confirmOpener = useRef<HTMLElement | null>(null);

  /**
   * The registry, also held in a ref.
   *
   * Admission has to be decided *now* — the click either starts an action or it
   * does not — and a state updater does not run when it is called, it runs when
   * React next renders. Reading the outcome of `beginAction` out of an updater's
   * closure therefore always saw its initial value, and every action was
   * refused. The ref is the value; the state is how it reaches the screen.
   */
  const registryRef = useRef<InFlightRegistry>(EMPTY_REGISTRY);
  const commitRegistry = useCallback((next: InFlightRegistry) => {
    registryRef.current = next;
    setRegistry(next);
  }, []);

  const inFlight = useMemo(() => inFlightView(registry), [registry]);

  const runAction = useCallback(
    (
      scope: ActionScope,
      run: () => Promise<Outcome>,
      describe: (outcome: Outcome) => Notice,
    ) => {
      const { registry: next, admitted } = beginAction(
        registryRef.current,
        scope,
        Date.now(),
      );

      // Refused because this page already has something in flight. The running
      // action is left alone and no second one starts.
      if (!admitted) return;
      commitRegistry(next);

      const finish = (outcome: Outcome) => {
        // A late answer to an action that is no longer registered is dropped
        // rather than reported over whatever has happened since.
        if (!isRunning(registryRef.current, scope)) return;
        commitRegistry(settleAction(registryRef.current, scope));

        const message = describe(outcome);
        setNotice(message);
        if (scope.kind === 'page') {
          setOutcomes((current) => {
            const map = new Map(current);
            map.set(scope.pageNumber, message);
            return map;
          });
        }
      };

      void run()
        .then(finish)
        .catch((error: unknown) =>
          finish({
            ok: false,
            error: error instanceof Error ? error.message : 'Something went wrong.',
          }),
        );
    },
    [commitRegistry],
  );

  /** Start a page action, naming it so the card and the notice agree. */
  const runPageAction = useCallback(
    (pageNumber: number, action: PageActionName, run: () => Promise<Outcome>) => {
      runAction({ kind: 'page', pageNumber, action }, run, (outcome) =>
        outcome.ok
          ? pageActionSucceeded(action, pageNumber)
          : pageActionFailed(action, pageNumber, outcome.error),
      );
    },
    [runAction],
  );

  /**
   * Move one page to another number.
   *
   * A block move of one, which is the only move primitive the server has — so a
   * nudge and a named destination are the same request with a different arrow.
   * The success message names where the page ended up rather than where it was,
   * because "page 204 moved" is unhelpful when 204 is no longer it.
   */
  const move = useCallback(
    (pageNumber: number, destination: number, action: PageActionName) => {
      runAction(
        { kind: 'page', pageNumber, action },
        () => data.moveBlock(pageNumber, pageNumber, destination),
        (outcome) => {
          if (outcome.ok) onMoved();
          return outcome.ok
            ? blockMoved(pageNumber, pageNumber, destination)
            : pageActionFailed(action, pageNumber, outcome.error);
        },
      );
    },
    [runAction, data, onMoved],
  );

  const nudge = useCallback(
    (pageNumber: number, delta: -1 | 1) => {
      // Slides whatever it passes over rather than needing a free slot. The card
      // says so before it is pressed.
      move(pageNumber, pageNumber + delta, delta < 0 ? 'nudge-lower' : 'nudge-higher');
    },
    [move],
  );

  /**
   * Fold another page in as a subpage.
   *
   * Registered against the *target*, so the card that started it is the one
   * that goes busy — and so a second click cannot start it again while the
   * screens are still moving across.
   */
  const absorbPage = useCallback(
    (target: number, source: number) => {
      runPageAction(target, 'absorb-page', async () => {
        const result = await data.absorbPage(target, source);
        if (result.ok) onAbsorbed();
        return result;
      });
    },
    [runPageAction, data, onAbsorbed],
  );

  const moveTo = useCallback(
    (pageNumber: number, destination: number) => {
      move(pageNumber, destination, 'move-to');
    },
    [move],
  );

  /**
   * Lengthen or shorten a page's carousel.
   *
   * Run through `runAction` like everything else rather than called straight,
   * even though adding a screen is one synchronous write: the card's controls
   * disable off `pageBusy`, and a control that stayed live during its own action
   * is exactly how a page ends up with two screens from one double-click.
   *
   * Refusals — at the cap, or down to the last screen — return `null` rather
   * than throwing, and are reported as a failure with the reason rather than
   * silently doing nothing.
   */
  const addSubpage = useCallback(
    (pageNumber: number) => {
      runPageAction(pageNumber, 'add-subpage', async () => {
        const added = data.addSubpage(pageNumber);
        return added == null
          ? { ok: false as const, error: `Page ${pageNumber} is already at the maximum.` }
          : { ok: true as const };
      });
    },
    [runPageAction, data],
  );

  const removeLastSubpage = useCallback(
    (pageNumber: number) => {
      runPageAction(pageNumber, 'remove-subpage', async () => {
        const remaining = await data.removeLastSubpage(pageNumber);
        return remaining == null
          ? {
              ok: false as const,
              error: `Page ${pageNumber} has only one subpage, which is the page itself.`,
            }
          : { ok: true as const };
      });
    },
    [runPageAction, data],
  );

  const setRole = useCallback(
    (pageNumber: number, kind: PageKind) => {
      runAction(
        { kind: 'page', pageNumber, action: 'set-role' },
        async () => {
          setKind(pageNumber, kind);
          return { ok: true as const };
        },
        (outcome) =>
          outcome.ok
            ? roleChanged(pageNumber, kind)
            : pageActionFailed('set-role', pageNumber, outcome.error),
      );
    },
    [runAction, setKind],
  );

  const saveText = useCallback(
    (pageNumber: number, title: string, description: string) => {
      runAction(
        { kind: 'page', pageNumber, action: 'save-text' },
        async () => {
          const result = data.savePageText(pageNumber, title, description);
          // Refused before either store was written, so nothing is half-saved and
          // the draft is left in place for a correction.
          return result.ok
            ? { ok: true as const }
            : {
                ok: false as const,
                error: textTooLong(
                  result.field,
                  result.field === 'title' ? MAX_TITLE_LENGTH : MAX_DESCRIPTION_LENGTH,
                ).text,
              };
        },
        (outcome) => {
          if (outcome.ok) onTextSaved(pageNumber);
          return outcome.ok
            ? pageActionSucceeded('save-text', pageNumber)
            : pageActionFailed('save-text', pageNumber, outcome.error);
        },
      );
    },
    [runAction, data, onTextSaved],
  );

  const publish = useCallback(
    (input: PublishInput) => {
      const { pageNumber, kind } = input;
      runAction(
        { kind: 'publish' },
        async () => {
          const result = await data.publish(input);
          // The role goes on after the content, and only if the content landed:
          // a heading with nothing under it would be a directory entry for a page
          // that is not there.
          if (result.ok && kind != null) setKind(pageNumber, kind);
          return result;
        },
        (outcome) =>
          outcome.ok
            ? publishSucceeded(pageNumber)
            : publishFailed(pageNumber, outcome.error),
      );
    },
    [runAction, data, setKind],
  );

  /**
   * Publish a run of captures onto consecutive page numbers.
   *
   * Sequential rather than concurrent, deliberately: each publish is a database
   * write followed by a playhtml write, and firing twenty of those at once would
   * interleave the second halves unpredictably and reload the publication records
   * twenty times. One at a time is also what makes a partial failure legible —
   * the run keeps going and reports which pages did not take.
   */
  const publishBatch = useCallback(
    (items: readonly BatchItem[], startPage: number, kind: PageKind) => {
      if (items.length === 0) return;

      runAction(
        { kind: 'publish' },
        async () => {
          const failed: number[] = [];
          let lastError = '';

          for (const [index, item] of items.entries()) {
            const pageNumber = startPage + index;
            const result = await data.publish({
              pageNumber,
              captureId: item.id,
              title: item.title,
              description: '',
              transforms: { shiftDown: true, menuId: null },
            });
            if (result.ok) {
              setKind(pageNumber, kind);
            } else {
              failed.push(pageNumber);
              lastError = result.error;
            }
          }

          return failed.length === 0
            ? { ok: true as const }
            : {
                ok: false as const,
                error: `${failed.length} of ${items.length} did not publish (${failed.join(', ')}). ${lastError}`,
              };
        },
        (outcome) =>
          outcome.ok
            ? batchPublished(items.length, startPage)
            : { tone: 'alert', text: outcome.error },
      );
    },
    [runAction, data, setKind],
  );

  /**
   * Re-publish pages whose transforms changed.
   *
   * The same sequential loop as a batch publish, for the same reasons — one
   * database write plus one playhtml write each, and a partial failure that names
   * the pages it left alone.
   */
  const republish = useCallback(
    (items: readonly PublishInput[]) => {
      if (items.length === 0) return;

      runAction(
        { kind: 'publish' },
        async () => {
          const failed: number[] = [];
          let lastError = '';

          for (const item of items) {
            const result = await data.publish(item);
            if (!result.ok) {
              failed.push(item.pageNumber);
              lastError = result.error;
            }
          }

          return failed.length === 0
            ? { ok: true as const }
            : {
                ok: false as const,
                error: `${failed.length} of ${items.length} did not re-publish (${failed.join(', ')}). ${lastError}`,
              };
        },
        (outcome) =>
          outcome.ok
            ? transformsApplied(items.map((item) => item.pageNumber))
            : { tone: 'alert', text: outcome.error },
      );
    },
    [runAction, data],
  );

  const askConfirm = useCallback((request: ConfirmRequest) => {
    confirmOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirming(request);
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirming(null);
    const opener = confirmOpener.current;
    confirmOpener.current = null;
    // The control that opened it may have gone with the page it deleted, in which
    // case focus goes to the line that says what happened.
    if (opener != null && document.contains(opener)) opener.focus();
    else noticeRef.current?.focus();
  }, [noticeRef]);

  const confirmAction = useCallback(() => {
    const request = confirming;
    closeConfirm();
    if (request == null) return;

    // Delete is the one confirmed Page_Action now: taking a page off air always
    // means emptying it, whether or not it had a publication record, so there is
    // nothing left for a separate confirmed unpublish to mean.
    runPageAction(request.pageNumber, 'delete', () => data.deletePage(request.pageNumber));
  }, [confirming, closeConfirm, runPageAction, data]);

  return {
    notice,
    setNotice,
    inFlight,
    outcomes,
    confirming,
    askConfirm,
    closeConfirm,
    confirmAction,
    nudge,
    addSubpage,
    removeLastSubpage,
    absorbPage,
    moveTo,
    setRole,
    saveText,
    publish,
    publishBatch,
    republish,
  };
}
