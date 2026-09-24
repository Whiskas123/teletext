/**
 * Starting an action on `/manage`, and reporting how it went.
 *
 * Two kinds of action, with two kinds of lock.
 *
 * **Page actions** touch one page and nothing else — saving its title, adding
 * a screen, putting it on the front page. They are admitted one per page
 * (`domain/inFlight.ts`), so a slow save on 204 never freezes 512.
 *
 * **Structural actions** renumber, publish or delete, and may touch any number
 * of pages: a drag, adding twenty captures, merging a story back together.
 * They share one lock. Two of them interleaving is how a page gets lost — the
 * second plans against page numbers the first is in the middle of changing —
 * so while one runs the list is read-only, and says so with a progress line.
 *
 * Either way the outcome lands in the one notice the screen shows, with a tone,
 * and a page action's outcome is also kept against its page so the row can
 * show it after the notice has moved on.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type {
  ArchiveAdminApi,
  PublishedEntry,
  PublishTransforms,
} from '../../collab/useArchiveAdmin';
import type { ShowcaseApi } from '../../collab/useShowcase';
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
import { describeRange } from '../../domain/lineup';
import {
  pageActionFailed,
  pageActionSucceeded,
  roleChanged,
  textTooLong,
  type Notice,
} from '../../domain/manageMessages';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../domain/publication';
import type { PageMove } from '../../domain/reorder';
import { suggestTitle } from '../../domain/suggestTitle';

type Outcome = { ok: true } | { ok: false; error: string };

/** What a bulk change of transforms sets, leaving anything it does not name alone. */
export interface TransformPatch {
  shiftDown: boolean | null;
  menuId: number | null | 'keep';
}

/**
 * A capture on its way to a page, with the title it should carry. An empty
 * title is read off the capture's own text on the way (`suggestTitle`) — all
 * of SIC arrives untitled, and a blank title is a blank line in the directory.
 */
export interface IncomingCapture {
  id: number;
  title: string;
}

/** Adding captures from the archive, in one of the four ways it can be done. */
export type AddCapturesRequest =
  | {
      /** As new pages, each on its own number. */
      mode: 'pages';
      captures: readonly IncomingCapture[];
      /** Renumberings that make room first (`planArrangement`). */
      moves: readonly PageMove[];
      /** The numbers the captures land on, in order. */
      placed: readonly number[];
      transforms: PublishTransforms;
      kind: PageKind;
    }
  | {
      /** As one new page, the captures its screens in order — a whole story. */
      mode: 'story';
      captures: readonly IncomingCapture[];
      /** Renumberings that make room first (`planArrangement`). */
      moves: readonly PageMove[];
      pageNumber: number;
      transforms: PublishTransforms;
      kind: PageKind;
    }
  | {
      /** As more screens on the end of one page's carousel. */
      mode: 'screens';
      captures: readonly IncomingCapture[];
      pageNumber: number;
      firstSubpage: number;
      transforms: PublishTransforms;
    }
  | {
      /** In place of one screen that is already there. */
      mode: 'replace';
      capture: IncomingCapture;
      pageNumber: number;
      subpage: number;
      transforms: PublishTransforms;
    };

/** How far a long structural action has got. */
export interface Progress {
  label: string;
  done: number;
  total: number;
}

export interface ManageActionsInput {
  data: ArchiveAdminApi;
  showcase: Pick<ShowcaseApi, 'add' | 'remove' | 'entries'>;
  setKind(pageNumber: number, kind: PageKind): void;
}

export interface ManageActionsApi {
  notice: Notice | null;
  setNotice(notice: Notice | null): void;
  inFlight: InFlightView;
  /** How each page's last settled page action went. */
  outcomes: ReadonlyMap<number, Notice>;
  /** Whether a structural action holds the lock. */
  structuralBusy: boolean;
  progress: Progress | null;

  /** Renumber pages. Resolves true once both stores have moved. */
  arrange(moves: readonly PageMove[], summary: string): Promise<boolean>;
  addCaptures(request: AddCapturesRequest): Promise<boolean>;
  deletePages(pageNumbers: readonly number[]): Promise<boolean>;
  /** Fold each source's carousel onto the end of `target`'s, in order. */
  mergePages(target: number, sources: readonly number[]): Promise<boolean>;
  /** Re-publish every archive screen of these pages with new transforms. */
  applyTransforms(pageNumbers: readonly number[], patch: TransformPatch): Promise<boolean>;
  setRole(pageNumbers: readonly number[], kind: PageKind): void;
  /** Give every untitled page among these a title read off its first screen. */
  fillTitles(pageNumbers: readonly number[]): void;

  /**
   * Move old publication records into playhtml, beside the screens they
   * describe. Each capture is rendered with its recorded transforms, so a
   * screen edited by hand since shows as edited.
   */
  moveInLegacy(records: readonly PublishedEntry[]): Promise<boolean>;
  /** Publish old records whose screens are empty back onto them. */
  restoreLegacy(records: readonly PublishedEntry[]): Promise<boolean>;
  /** Stop offering old records, leaving the service as it is. */
  discardLegacy(records: readonly PublishedEntry[]): Promise<boolean>;

  saveText(pageNumber: number, title: string, description: string): Promise<boolean>;
  addSubpage(pageNumber: number): void;
  removeLastSubpage(pageNumber: number): void;
  toggleShowcase(pageNumber: number, subpage: number, on: boolean): void;
}

const status = (text: string): Notice => ({ tone: 'status', text });
const alert = (text: string): Notice => ({ tone: 'alert', text });

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function useManageActions({
  data,
  showcase,
  setKind,
}: ManageActionsInput): ManageActionsApi {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registry, setRegistry] = useState<InFlightRegistry>(EMPTY_REGISTRY);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, Notice>>(new Map());
  const [progress, setProgress] = useState<Progress | null>(null);

  /**
   * The registry, also held in a ref: admission has to be decided *now*, and a
   * state updater runs on the next render, not when it is called.
   */
  const registryRef = useRef<InFlightRegistry>(EMPTY_REGISTRY);
  const commitRegistry = useCallback((next: InFlightRegistry) => {
    registryRef.current = next;
    setRegistry(next);
  }, []);

  const inFlight = useMemo(() => inFlightView(registry), [registry]);

  const runAction = useCallback(
    async (
      scope: ActionScope,
      run: () => Promise<Outcome>,
      describe: (outcome: Outcome) => Notice,
    ): Promise<boolean> => {
      const { registry: next, admitted } = beginAction(
        registryRef.current,
        scope,
        Date.now(),
      );
      if (!admitted) return false;
      commitRegistry(next);

      let outcome: Outcome;
      try {
        outcome = await run();
      } catch (error) {
        outcome = {
          ok: false,
          error: error instanceof Error ? error.message : 'Something went wrong.',
        };
      }

      // A late answer to an action that is no longer registered is dropped
      // rather than reported over whatever has happened since.
      if (!isRunning(registryRef.current, scope)) return false;
      commitRegistry(settleAction(registryRef.current, scope));
      if (scope.kind === 'publish') setProgress(null);

      const message = describe(outcome);
      setNotice(message);
      if (scope.kind === 'page') {
        setOutcomes((current) => new Map(current).set(scope.pageNumber, message));
      }
      return outcome.ok;
    },
    [commitRegistry],
  );

  /** The structural lock. `publish` is its historical name in the registry. */
  const runStructural = useCallback(
    (run: () => Promise<Outcome>, describe: (outcome: Outcome) => Notice) =>
      runAction({ kind: 'publish' }, run, describe),
    [runAction],
  );

  const runPageAction = useCallback(
    (pageNumber: number, action: PageActionName, run: () => Promise<Outcome>) =>
      runAction({ kind: 'page', pageNumber, action }, run, (outcome) =>
        outcome.ok
          ? pageActionSucceeded(action, pageNumber)
          : pageActionFailed(action, pageNumber, outcome.error),
      ),
    [runAction],
  );

  /**
   * Run `step` over `items` one at a time, counting as it goes.
   *
   * Sequential on purpose: each publish is a database write followed by a
   * playhtml write, and twenty at once would interleave the second halves and
   * reload the records twenty times. One at a time is also what makes a
   * partial failure legible — the run carries on and names what did not take.
   */
  const sequence = useCallback(
    async <T,>(
      label: string,
      items: readonly T[],
      step: (item: T, index: number) => Promise<Outcome>,
      name: (item: T) => string,
    ): Promise<Outcome> => {
      const failed: string[] = [];
      let lastError = '';
      setProgress({ label, done: 0, total: items.length });
      for (const [index, item] of items.entries()) {
        const result = await step(item, index);
        if (!result.ok) {
          failed.push(name(item));
          lastError = result.error;
        }
        setProgress({ label, done: index + 1, total: items.length });
      }
      return failed.length === 0
        ? { ok: true }
        : {
            ok: false,
            error: `${failed.length} of ${items.length} did not complete (${failed.join(', ')}). ${lastError}`,
          };
    },
    [],
  );

  /** The capture's own title, or one read off its text when it has none. */
  const titleFor = useCallback(
    async (capture: IncomingCapture): Promise<string> => {
      if (capture.title.trim() !== '') return capture.title;
      const cells = await data.loadPage(capture.id);
      return cells == null ? '' : suggestTitle(cells);
    },
    [data],
  );

  const arrange = useCallback(
    (moves: readonly PageMove[], summary: string) => {
      if (moves.length === 0) return Promise.resolve(true);
      return runStructural(
        async () => {
          setProgress({ label: 'Renumbering', done: 0, total: 1 });
          return data.arrange(moves);
        },
        (outcome) => (outcome.ok ? status(summary) : alert(outcome.error)),
      );
    },
    [runStructural, data],
  );

  const addCaptures = useCallback(
    (request: AddCapturesRequest) =>
      runStructural(
        async () => {
          if (request.mode === 'replace') {
            setProgress({ label: 'Publishing', done: 0, total: 1 });
            return data.publish({
              pageNumber: request.pageNumber,
              subpage: request.subpage,
              captureId: request.capture.id,
              // A screen swap is not a retitling: the page keeps its own words.
              title: data.titleOf(request.pageNumber),
              description: data.descriptionOf(request.pageNumber),
              transforms: request.transforms,
            });
          }

          if (request.mode === 'screens') {
            const title = data.titleOf(request.pageNumber);
            const description = data.descriptionOf(request.pageNumber);
            return sequence(
              'Adding screens',
              request.captures,
              (capture, index) =>
                data.publish({
                  pageNumber: request.pageNumber,
                  subpage: request.firstSubpage + index,
                  captureId: capture.id,
                  title,
                  description,
                  transforms: request.transforms,
                }),
              (capture) => `capture ${capture.id}`,
            );
          }

          if (request.mode === 'story') {
            if (request.moves.length > 0) {
              setProgress({ label: 'Making room', done: 0, total: 1 });
              const made = await data.arrange(request.moves);
              if (!made.ok) return made;
            }
            // The story's title is its first screen's; every screen after it
            // goes in under the same one, since a title belongs to the page.
            const title = request.captures.length > 0 ? await titleFor(request.captures[0]) : '';
            const result = await sequence(
              'Publishing screens',
              request.captures,
              (capture, index) =>
                data.publish({
                  pageNumber: request.pageNumber,
                  subpage: index + 1,
                  captureId: capture.id,
                  title,
                  description: '',
                  transforms: request.transforms,
                }),
              (capture) => `capture ${capture.id}`,
            );
            if (result.ok) setKind(request.pageNumber, request.kind);
            return result;
          }

          // New pages: make room, then publish onto the freed numbers. The
          // room is made first and as one step, so a publish that fails half
          // way leaves a gap rather than a page overwritten.
          if (request.moves.length > 0) {
            setProgress({ label: 'Making room', done: 0, total: 1 });
            const made = await data.arrange(request.moves);
            if (!made.ok) return made;
          }
          return sequence(
            'Publishing',
            request.captures,
            async (capture, index) => {
              const pageNumber = request.placed[index];
              const result = await data.publish({
                pageNumber,
                captureId: capture.id,
                title: await titleFor(capture),
                description: '',
                transforms: request.transforms,
              });
              // The role goes on only once the content has landed: a heading
              // with nothing under it is a directory entry for nothing.
              if (result.ok) setKind(pageNumber, request.kind);
              return result;
            },
            (capture) => String(request.placed[request.captures.indexOf(capture)]),
          );
        },
        (outcome) => {
          if (!outcome.ok) return alert(outcome.error);
          if (request.mode === 'replace') {
            return status(
              `Screen ${request.subpage} of page ${request.pageNumber} replaced.`,
            );
          }
          if (request.mode === 'story') {
            return status(
              `Page ${request.pageNumber} added with ${plural(request.captures.length, 'screen')}.`,
            );
          }
          if (request.mode === 'screens') {
            const last = request.firstSubpage + request.captures.length - 1;
            return status(
              `Page ${request.pageNumber} gained ${plural(request.captures.length, 'screen')} ` +
                `(${request.firstSubpage === last ? request.firstSubpage : `${request.firstSubpage}–${last}`}).`,
            );
          }
          return status(
            `Added ${plural(request.captures.length, 'page')} at ${describeRange(request.placed)}.`,
          );
        },
      ),
    [runStructural, data, sequence, setKind, titleFor],
  );

  /**
   * Adding captures, then refreshing the archive's list — which hides what is
   * published — so what was just placed drops out of the list of what is left.
   */
  const addCapturesAndRefresh = useCallback(
    async (request: AddCapturesRequest) => {
      const done = await addCaptures(request);
      data.retryCaptures();
      return done;
    },
    [addCaptures, data],
  );

  const deletePages = useCallback(
    (pageNumbers: readonly number[]) =>
      runStructural(
        () =>
          sequence('Deleting', pageNumbers, (page) => data.deletePage(page), String),
        (outcome) =>
          outcome.ok
            ? status(
                pageNumbers.length === 1
                  ? `Page ${pageNumbers[0]} deleted.`
                  : `${pageNumbers.length} pages deleted (${describeRange(pageNumbers)}).`,
              )
            : alert(outcome.error),
      ),
    [runStructural, sequence, data],
  );

  const mergePages = useCallback(
    (target: number, sources: readonly number[]) =>
      runStructural(
        async () => {
          // One at a time and stopping at the first failure: each absorb reads
          // the target's carousel length, which the one before it changed.
          setProgress({ label: 'Merging', done: 0, total: sources.length });
          for (const [index, source] of sources.entries()) {
            const result = await data.absorbPage(target, source);
            if (!result.ok) return result;
            setProgress({ label: 'Merging', done: index + 1, total: sources.length });
          }
          return { ok: true as const };
        },
        (outcome) =>
          outcome.ok
            ? status(
                `${sources.length === 1 ? `Page ${sources[0]} is` : `Pages ${describeRange(sources)} are`} ` +
                  `now screens of page ${target}.`,
              )
            : alert(outcome.error),
      ),
    [runStructural, data],
  );

  /**
   * Re-publish pages with new transforms.
   *
   * Driven off the records rather than the page numbers, so every archive
   * screen of a carousel is included — a bottom bar changed on page 220 has to
   * land on all of its screens. The title comes from the live document, so an
   * edit made since publication is not reverted by a change of bar.
   */
  const applyTransforms = useCallback(
    (pageNumbers: readonly number[], patch: TransformPatch) => {
      const chosen = new Set(pageNumbers);
      const records = data.published.filter((entry) => chosen.has(entry.page_number));
      if (records.length === 0) return Promise.resolve(true);

      return runStructural(
        () =>
          sequence(
            'Re-publishing',
            records,
            (entry) =>
              data.publish({
                pageNumber: entry.page_number,
                subpage: entry.subpage ?? 1,
                captureId: entry.capture_id,
                title: data.titleOf(entry.page_number) || entry.title,
                description: data.descriptionOf(entry.page_number) || entry.description,
                transforms: {
                  shiftDown: patch.shiftDown ?? entry.shift_down,
                  menuId: patch.menuId === 'keep' ? entry.menu_id : patch.menuId,
                },
              }),
            (entry) => `${entry.page_number}/${entry.subpage ?? 1}`,
          ),
        (outcome) =>
          outcome.ok
            ? status(
                `${plural(records.length, 'screen')} on ${plural(chosen.size, 'page')} re-published.`,
              )
            : alert(outcome.error),
      );
    },
    [runStructural, sequence, data],
  );

  const setRole = useCallback(
    (pageNumbers: readonly number[], kind: PageKind) => {
      // A synchronous write per page to the live document; nothing to wait on.
      for (const page of pageNumbers) setKind(page, kind);
      setNotice(
        pageNumbers.length === 1
          ? roleChanged(pageNumbers[0], kind)
          : status(`${pageNumbers.length} pages are now ${kind === 'page' ? 'pages' : `${kind} headings`}.`),
      );
    },
    [setKind],
  );

  const fillTitles = useCallback(
    (pageNumbers: readonly number[]) => {
      let filled = 0;
      for (const page of pageNumbers) {
        if (data.titleOf(page).trim() !== '') continue;
        const cells = data.livePage(page, 1);
        const title = cells == null ? '' : suggestTitle(cells);
        if (title === '') continue;
        if (data.savePageText(page, title, data.descriptionOf(page)).ok) filled += 1;
      }
      setNotice(
        filled === 0
          ? status('No untitled page here had a line to use as a title.')
          : status(`${plural(filled, 'page')} given a title from its own text.`),
      );
    },
    [data],
  );

  const moveInLegacy = useCallback(
    (records: readonly PublishedEntry[]) =>
      runStructural(
        async () => {
          const moved: PublishedEntry[] = [];
          const result = await sequence(
            'Moving records in',
            records,
            async (record) => {
              const rendered = await data.render(record.capture_id, {
                shiftDown: record.shift_down,
                menuId: record.menu_id,
              });
              if (rendered == null) return { ok: false, error: 'The capture could not be rendered.' };
              data.legacy.adopt(record, rendered);
              moved.push(record);
              return { ok: true };
            },
            (record) => `${record.page_number}/${record.subpage ?? 1}`,
          );
          const resolved = await data.legacy.resolve(moved);
          return resolved.ok ? result : resolved;
        },
        (outcome) =>
          outcome.ok
            ? status(`${plural(records.length, 'record')} moved into the live pages.`)
            : alert(outcome.error),
      ),
    [runStructural, sequence, data],
  );

  const restoreLegacy = useCallback(
    (records: readonly PublishedEntry[]) =>
      runStructural(
        async () => {
          const restored: PublishedEntry[] = [];
          const result = await sequence(
            'Restoring',
            records,
            async (record) => {
              const outcome = await data.publish({
                pageNumber: record.page_number,
                subpage: record.subpage ?? 1,
                captureId: record.capture_id,
                title: data.titleOf(record.page_number) || record.title,
                description: data.descriptionOf(record.page_number) || record.description,
                transforms: { shiftDown: record.shift_down, menuId: record.menu_id },
              });
              if (outcome.ok) restored.push(record);
              return outcome;
            },
            (record) => `${record.page_number}/${record.subpage ?? 1}`,
          );
          const resolved = await data.legacy.resolve(restored);
          return resolved.ok ? result : resolved;
        },
        (outcome) =>
          outcome.ok
            ? status(`${plural(records.length, 'screen')} restored from the archive.`)
            : alert(outcome.error),
      ),
    [runStructural, sequence, data],
  );

  const discardLegacy = useCallback(
    (records: readonly PublishedEntry[]) =>
      runStructural(
        () => data.legacy.resolve(records),
        (outcome) =>
          outcome.ok
            ? status(`${plural(records.length, 'old record')} set aside. The live pages are unchanged.`)
            : alert(outcome.error),
      ),
    [runStructural, data],
  );

  const saveText = useCallback(
    (pageNumber: number, title: string, description: string) =>
      runPageAction(pageNumber, 'save-text', async () => {
        const result = data.savePageText(pageNumber, title, description);
        // Refused before either store was written, so nothing is half-saved.
        return result.ok
          ? { ok: true as const }
          : {
              ok: false as const,
              error: textTooLong(
                result.field,
                result.field === 'title' ? MAX_TITLE_LENGTH : MAX_DESCRIPTION_LENGTH,
              ).text,
            };
      }),
    [runPageAction, data],
  );

  /**
   * Lengthen or shorten a carousel. Run as page actions even though adding is
   * one synchronous write: a control that stays live during its own action is
   * how a page ends up with two new screens from one double-click.
   */
  const addSubpage = useCallback(
    (pageNumber: number) => {
      void runPageAction(pageNumber, 'add-subpage', async () =>
        data.addSubpage(pageNumber) == null
          ? { ok: false as const, error: `Page ${pageNumber} is already at the maximum.` }
          : { ok: true as const },
      );
    },
    [runPageAction, data],
  );

  const removeLastSubpage = useCallback(
    (pageNumber: number) => {
      void runPageAction(pageNumber, 'remove-subpage', async () =>
        (await data.removeLastSubpage(pageNumber)) == null
          ? {
              ok: false as const,
              error: `Page ${pageNumber} has one screen, which is the page itself.`,
            }
          : { ok: true as const },
      );
    },
    [runPageAction, data],
  );

  /**
   * Put one screen on the front page's strip, or take it off. Adding draws the
   * page here and uploads the picture, which is why it is a page action with a
   * busy state rather than a checkbox.
   */
  const toggleShowcase = useCallback(
    (pageNumber: number, subpage: number, on: boolean) => {
      void runAction(
        { kind: 'page', pageNumber, action: 'showcase' },
        () =>
          on
            ? showcase.remove(pageNumber, subpage)
            : showcase.add(pageNumber, subpage, showcase.entries.length),
        (outcome) => {
          if (!outcome.ok) return pageActionFailed('showcase', pageNumber, outcome.error);
          const where = subpage > 1 ? `${pageNumber}/${subpage}` : `${pageNumber}`;
          return status(
            on ? `Page ${where} taken off the front page.` : `Page ${where} added to the front page.`,
          );
        },
      );
    },
    [runAction, showcase],
  );

  return {
    notice,
    setNotice,
    inFlight,
    outcomes,
    structuralBusy: inFlight.publishBusy,
    progress,
    arrange,
    addCaptures: addCapturesAndRefresh,
    deletePages,
    mergePages,
    applyTransforms,
    setRole,
    fillTitles,
    moveInLegacy,
    restoreLegacy,
    discardLegacy,
    saveText,
    addSubpage,
    removeLastSubpage,
    toggleShowcase,
  };
}
