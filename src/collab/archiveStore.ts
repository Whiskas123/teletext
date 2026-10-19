/**
 * The curated archive (pages 100..699), held in the browser and saved to the
 * database — and `useContentChannel`, which every screen reads pages through.
 *
 * ## Why the archive left playhtml
 *
 * Every page used to live in the one playhtml document. It grew to ~8 MB, in
 * the size band playhtml's server runs out of memory loading, and from
 * 2026-10-16 the room crashed on every connect: nothing live worked. The
 * curated archive was 92% of that document, yet only moderators edit it — so
 * it now lives where it was already backed up, `live_pages`, and playhtml keeps
 * only what visitors edit together (`domain/contentStores.ts` draws the line).
 *
 * ## Reading
 *
 * Everyone reads the archive from the same file the screens already drew from
 * before playhtml synced (`/api/snapshot?boot=1`, cached at the edge for a
 * minute — see `bootData.ts`). It is no longer a stand-in to be replaced: for
 * archive pages it is the content. A moderator's change reaches other viewers
 * on their next load; there is deliberately no live signal for it.
 *
 * ## Writing
 *
 * Only after a *fresh* read (`loadArchiveFresh`), never from the edge's copy,
 * so a moderator cannot save over their own last save with a minute-old page.
 * Writes change the copy here at once and are sent by the same engine that
 * mirrors playhtml to the database (`createMirror`), scoped to archive pages:
 * it waits for edits to settle, sends only the screens whose fingerprint
 * changed, and holds large deletions for confirmation. Pages a write empties
 * on purpose are confirmed as it happens.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { usePageData, usePlayContext } from '@playhtml/react';

import { isArchivePage } from '../domain/access';
import { BOOT_LIVE_PATH, parseBootData, type BootData } from '../domain/bootData';
import { isArchiveKey, pickStore, splitChanges } from '../domain/contentStores';
import { claimedPages, type LiveChannels } from '../domain/liveMirror';
import { getBoot, loadBootData, subscribeBoot, usePageDataWithBoot } from './bootData';
import { QUIET_MS, createMirror, type MirrorStatus } from './liveMirror';

/** The channels that hold page content, by their playhtml ids. */
export type ContentChannel =
  | 'pages'
  | 'titles'
  | 'page-kinds'
  | 'descriptions'
  | 'subpage-counts'
  | 'page-sources';

const CHANNELS: readonly ContentChannel[] = [
  'pages',
  'titles',
  'page-kinds',
  'descriptions',
  'subpage-counts',
  'page-sources',
];

type ArchiveData = Record<ContentChannel, Record<string, unknown>>;

/** The archive's part of a boot file. */
function archiveOf(data: BootData | null): ArchiveData {
  const source = (data ?? {}) as Partial<Record<ContentChannel, Record<string, unknown>>>;
  return Object.fromEntries(
    CHANNELS.map((channel) => [channel, pickStore(source[channel], true)]),
  ) as ArchiveData;
}

/** The same data in the shape the mirror engine reads. */
function asLive(data: ArchiveData): LiveChannels {
  return {
    pages: data.pages,
    titles: data.titles,
    kinds: data['page-kinds'] as LiveChannels['kinds'],
    descriptions: data.descriptions,
    counts: data['subpage-counts'] as LiveChannels['counts'],
    sources: data['page-sources'],
  };
}

/* --- the store ------------------------------------------------------------ */

/** Loaded fresh and edited here; null until `loadArchiveFresh` lands. */
let own: ArchiveData | null = null;
/** What readers see before then: the boot file's archive, derived once per file. */
let fromBoot: { boot: BootData | null; data: ArchiveData } = { boot: null, data: archiveOf(null) };

export interface ArchiveSaveStatus {
  /** Read fresh from the database, so it may be listed and changed. */
  ready: boolean;
  /** `ready` once loaded fresh and nothing is waiting; the rest describe saving. */
  phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  error: string | null;
}
let saveStatus: ArchiveSaveStatus = { ready: false, phase: 'idle', error: null };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeBoot = subscribeBoot(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeBoot();
  };
}

function getArchive(): ArchiveData {
  if (own != null) return own;
  const boot = getBoot();
  if (fromBoot.boot !== boot) fromBoot = { boot, data: archiveOf(boot) };
  return fromBoot.data;
}

const getStatus = () => saveStatus;

function report(patch: Partial<ArchiveSaveStatus>) {
  saveStatus = { ...saveStatus, ...patch };
  notify();
}

/**
 * The engine that saves, made on first use: `liveMirror` imports the editing
 * hooks, which import this module, so it may not be finished loading yet when
 * this one is.
 */
let mirror: ReturnType<typeof createMirror> | null = null;
function engine(): ReturnType<typeof createMirror> {
  if (mirror != null) return mirror;
  mirror = createMirror({
    scope: isArchivePage,
    report: (patch: Partial<MirrorStatus>) => {
      if (patch.phase === 'saving') report({ phase: 'saving', error: null });
      else if (patch.phase === 'synced') report({ phase: 'ready', error: null });
      else if (patch.phase === 'error') report({ phase: 'error', error: patch.error ?? 'Not saved.' });
    },
  });
  // Closing the tab while a save is waiting would lose it: the engine waits
  // for edits to settle before sending. Ask first, as any editor would.
  window.addEventListener('beforeunload', (event) => {
    if (mirror?.busy()) event.preventDefault();
  });
  return mirror;
}

let freshRequest: Promise<boolean> | null = null;

/**
 * Read the archive straight from the database, past the edge's cache, so it
 * can be edited. Once per visit; resolves false if it could not be read, and
 * may then be asked again.
 */
export function loadArchiveFresh(): Promise<boolean> {
  if (own != null) return Promise.resolve(true);
  if (freshRequest != null) return freshRequest;
  report({ phase: 'loading', error: null });
  freshRequest = fetch(`${BOOT_LIVE_PATH}&fresh=1`, { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((json: unknown) => parseBootData(json))
    .catch(() => null)
    .then((data) => {
      if (data == null) {
        freshRequest = null;
        report({ phase: 'error', error: 'Could not read the curated pages from the database.' });
        return false;
      }
      own = archiveOf(data);
      report({ ready: true, phase: 'ready', error: null });
      return true;
    });
  return freshRequest;
}

function commit(next: ArchiveData): void {
  const before = claimedPages(asLive(own!));
  own = next;
  const live = asLive(next);
  const after = new Set(claimedPages(live));
  // Emptied by this write, on purpose: send the deletion rather than hold it.
  const saver = engine();
  saver.confirm(before.filter((page) => !after.has(page)));
  saver.setLive(live);
  saver.schedule(QUIET_MS);
  notify();
}

/**
 * Change one archive channel, the way playhtml's setters are called: a recipe
 * that mutates a draft. The draft is a deep copy, so the recipe can do as it
 * likes. Returns false — and changes nothing — until the archive has been
 * read fresh.
 */
export function setArchive<T>(channel: ContentChannel, recipe: (draft: T) => void): boolean {
  if (own == null) return false;
  const draft = structuredClone(own[channel]) as T;
  recipe(draft);
  commit({ ...own, [channel]: pickStore(draft as Record<string, unknown>, true) });
  return true;
}

/**
 * Change one entry of one channel — the editor's write, several times a
 * second while drawing, so it copies the page being drawn rather than every
 * page in the archive.
 */
export function setArchiveEntry<T>(
  channel: ContentChannel,
  key: string,
  recipe: (value: T) => T | void,
): boolean {
  if (own == null) return false;
  const current = own[channel][key];
  const draft = (current === undefined ? {} : structuredClone(current)) as T;
  const result = recipe(draft);
  commit({ ...own, [channel]: { ...own[channel], [key]: result === undefined ? draft : result } });
  return true;
}

/**
 * Write whole entries — a title, a kind, a page's cells — each to the store
 * its key belongs to. Nothing is written, and false is returned, if an archive
 * key is among them before the archive has been read fresh.
 */
export function writeEntries<D extends object>(
  channel: ContentChannel,
  entries: Readonly<Record<string, unknown>>,
  setLive: (recipe: (draft: D) => void) => void,
): boolean {
  const archive = pickStore(entries, true);
  const live = pickStore(entries, false);
  if (Object.keys(archive).length > 0) {
    const ok = setArchive<Record<string, unknown>>(channel, (draft) => Object.assign(draft, archive));
    if (!ok) return false;
  }
  if (Object.keys(live).length > 0) {
    setLive((draft) => {
      for (const [key, value] of Object.entries(live)) (draft as Record<string, unknown>)[key] = value;
    });
  }
  return true;
}

/**
 * Run a recipe written for the whole channel — a renumbering, a merge — and
 * send what it changed to each store.
 *
 * The recipe runs on a shallow copy of the merged view, so it can move a page
 * from the playground into the archive as easily as within either. It must
 * replace whole entries (`draft[key] = value`), never change one in place:
 * the entries are shared with what is on screen, and an edit inside one would
 * be neither seen as a change nor kept out of the current render. Every
 * `/manage` operation already works this way, because playhtml's draft needs
 * it too.
 *
 * Refused as a whole (false, nothing written) when a store it would touch is
 * not ready: playhtml drops a write made before it has synced, without a word.
 */
export function routeRecipe<T extends object>(
  channel: ContentChannel,
  merged: T,
  recipe: (draft: T) => void,
  setLive: (recipe: (draft: T) => void) => void,
  liveSynced: boolean,
): boolean {
  const before = merged as unknown as Record<string, unknown>;
  const draft = { ...merged };
  recipe(draft);
  const { archive, live } = splitChanges(before, draft as unknown as Record<string, unknown>);
  const touchesArchive = Object.keys(archive).length > 0;
  const touchesLive = Object.keys(live).length > 0;
  if ((touchesArchive && own == null) || (touchesLive && !liveSynced)) return false;
  if (touchesArchive) {
    setArchive<Record<string, unknown>>(channel, (copy) => {
      for (const [key, value] of Object.entries(archive)) {
        if (value === undefined) delete copy[key];
        else copy[key] = value;
      }
    });
  }
  if (touchesLive) {
    // playhtml cannot delete a key; callers vacate with an empty value instead.
    setLive((copy) => {
      for (const [key, value] of Object.entries(live)) {
        if (value !== undefined) (copy as Record<string, unknown>)[key] = value;
      }
    });
  }
  return true;
}

/** Whether a write to these pages would be refused right now, and why. */
export function refusalFor(pages: readonly number[], liveSynced: boolean): string | null {
  if (pages.some((page) => isArchiveKey(page)) && own == null) {
    return 'The curated pages are still loading from the database.';
  }
  if (pages.some((page) => !isArchiveKey(page)) && !liveSynced) {
    return 'The playground (700+) is not connected, so it cannot be changed right now.';
  }
  return null;
}

/**
 * A content channel to read and to write as a whole, for the operations that
 * span both stores (see `routeRecipe`). The setter returns whether it wrote.
 */
export function useRoutedChannel<T extends object>(
  channel: ContentChannel,
  defaultValue: T,
): [T, (recipe: (draft: T) => void) => boolean] {
  const merged = useContentChannel(channel, defaultValue);
  const [, setLive] = usePageData<T>(channel, defaultValue);
  const { isLoading, isProviderMissing } = usePlayContext();
  const synced = !isLoading && !isProviderMissing;
  const set = useCallback(
    (recipe: (draft: T) => void) => routeRecipe(channel, merged, recipe, setLive, synced),
    [channel, merged, setLive, synced],
  );
  return [merged, set];
}

/** Whether the archive has been read fresh and may be written. */
export const isArchiveReady = () => own != null;

/** The save status, for whoever is editing the archive. */
export function useArchiveStatus(): ArchiveSaveStatus {
  return useSyncExternalStore(subscribe, getStatus, getStatus);
}

/** The archive's half of a channel. */
export function useArchiveChannel(channel: ContentChannel): Record<string, unknown> {
  useEffect(() => loadBootData(), []);
  return useSyncExternalStore(subscribe, getArchive, getArchive)[channel];
}

/**
 * A content channel, whole: the curated archive from the database and the
 * playground from playhtml (or, until playhtml syncs, from the boot file).
 *
 * Read-only. Writes go to the store the page belongs to — `setArchive` for the
 * archive, playhtml's own setter for the rest — or through
 * `useRoutedSetter` for operations that span both.
 */
export function useContentChannel<T extends object>(channel: ContentChannel, defaultValue: T): T {
  const archive = useArchiveChannel(channel);
  const [live] = usePageDataWithBoot<T>(channel, defaultValue);
  return useMemo(
    () =>
      ({
        ...pickStore(live as Record<string, unknown>, false),
        ...archive,
      }) as T,
    [live, archive],
  );
}
