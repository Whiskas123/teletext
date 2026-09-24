/**
 * The live mirror: a signed-in moderator's browser keeps the database's copy of
 * the pages (`live_pages`) in step with playhtml, a few seconds behind.
 *
 * The rules, in `domain/liveMirror.ts`, decide *what* to send. This decides
 * *when*, and refuses in the cases where sending would do harm:
 *
 * - **Only on the live site's address.** playhtml keeps a separate document per
 *   hostname while every address shares one database, so a preview link or
 *   localhost mirroring its own document would overwrite the real backup with
 *   another site's pages — and delete the ones it does not have.
 * - **Only once playhtml has synced.** Before that the channels are empty, and
 *   an empty document looks exactly like one whose pages were all deleted.
 * - **Deletions that look like a broken document are held** for a person to
 *   confirm, from the status in `/manage`.
 *
 * It waits for edits to settle — three seconds of quiet, or twenty seconds at
 * most while someone keeps typing — then sends only the screens that changed,
 * compared by fingerprint against the copy's own list. Every five minutes it
 * re-reads that list, so another moderator's writes, or a restore, are noticed.
 *
 * The status is a module-level store, so the component doing the work (mounted
 * once for the whole app) and the `/manage` header showing it share one value.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePageData, usePlayContext } from '@playhtml/react';

import {
  applyMirrorPlan,
  isEmptyPlan,
  liveScreens,
  planMirror,
  type LiveChannels,
  type MirrorPlan,
} from '../domain/liveMirror';
import type { PageKinds } from '../domain/directory';
import { SOURCES_CHANNEL, readSource, type PageSources } from '../domain/pageSource';
import { SITE_URL } from '../domain/seo';
import { batchPages } from '../domain/snapshotBatch';
import { SUBPAGE_COUNTS_CHANNEL, pageKey, type SubpageCounts } from '../domain/subpages';
import { TITLES_CHANNEL } from './useGuide';
import { PAGES_CHANNEL } from './useEditPage';
import { PAGE_KINDS_CHANNEL } from './usePageKinds';
import { DESCRIPTIONS_CHANNEL } from './usePageText';

const QUIET_MS = 3_000;
const MAX_WAIT_MS = 20_000;
const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/* --- the shared status ---------------------------------------------------- */

export type MirrorPhase =
  /** Not a moderator's browser, or not mounted. */
  | 'off'
  /** Mounted on an address that is not the live site. */
  | 'wrong-host'
  /** Waiting for playhtml to sync. */
  | 'waiting'
  | 'saving'
  | 'synced'
  | 'error';

export interface MirrorStatus {
  phase: MirrorPhase;
  /** Screens the copy is behind by, as of the last check. */
  pending: number;
  /** Pages gone from the service whose deletion awaits confirmation. */
  held: number[];
  /** When the copy last matched the live pages. */
  lastSynced: number | null;
  error: string | null;
  /** The address this browser is on, for the wrong-host message. */
  host: string;
  /** The last daily read of the live document from the server, or null if none yet. */
  daily: {
    ranAt: string;
    ok: boolean;
    detail: string | null;
    /** No run for over a day and a half: the job has stopped, whatever the last one said. */
    stale: boolean;
  } | null;
}

let status: MirrorStatus = {
  phase: 'off',
  pending: 0,
  held: [],
  lastSynced: null,
  error: null,
  host: typeof location === 'undefined' ? '' : location.hostname,
  daily: null,
};

/** Ask how the last daily read went; shown in `/manage` when it failed or stopped. */
async function loadDailyStatus() {
  try {
    const response = await fetch('/api/snapshot', { credentials: 'same-origin' });
    if (!response.ok) return;
    const body = (await response.json()) as {
      daily?: { ran_at: string; ok: boolean; detail: string | null } | null;
    };
    const run = body.daily;
    setStatus({
      daily:
        run == null
          ? null
          : {
              ranAt: run.ran_at,
              ok: run.ok,
              detail: run.detail,
              stale: Date.now() - Date.parse(run.ran_at) > 36 * 60 * 60 * 1000,
            },
    });
  } catch {
    // Not knowing is shown as nothing, not as a failure.
  }
}
const listeners = new Set<() => void>();
/** Set by the mounted mirror; what the status buttons call. */
let controls: { resync(): void; confirmHeld(): void } | null = null;

function setStatus(patch: Partial<MirrorStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface MirrorApi extends MirrorStatus {
  /** Re-read the copy's list and send whatever differs, now. */
  resync(): void;
  /** Send the held deletions. */
  confirmHeld(): void;
}

/** The mirror's status, for showing in `/manage`. */
export function useMirrorStatus(): MirrorApi {
  const current = useSyncExternalStore(subscribe, () => status, () => status);
  return {
    ...current,
    resync: () => controls?.resync(),
    confirmHeld: () => controls?.confirmHeld(),
  };
}

/** The live site's hostname: the only one allowed to write the shared copy. */
export const LIVE_HOST = new URL(SITE_URL).hostname;

/* --- the mirror ----------------------------------------------------------- */

type CopyIndex = Map<string, string | null>;

async function fetchIndex(): Promise<CopyIndex> {
  const response = await fetch('/api/snapshot?index=1', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Could not read the backup's index (${response.status}).`);
  const body = (await response.json()) as { rows: [number, number, string | null][] };
  return new Map(body.rows.map(([page, screen, digest]) => [`${page}.${screen}`, digest]));
}

/**
 * Send a plan: the changed screens in batches that fit a request, then the
 * deletions last, once every write they might race has landed.
 */
async function sendPlan(plan: MirrorPlan, live: LiveChannels, digests: Map<string, string>) {
  const pages: Record<string, unknown> = {};
  for (const key of plan.upserts) {
    const [page, screen] = key.split('.').map(Number);
    const stored = String(pageKey(page, screen));
    pages[stored] = live.pages[stored] ?? {};
  }
  const meta = {
    titles: live.titles,
    kinds: live.kinds,
    descriptions: live.descriptions,
    subpageCounts: live.counts,
  };
  const batches = plan.upserts.length > 0 ? batchPages(pages) : [];
  const deletions = { removed: plan.removed, truncate: plan.truncate };
  const posts =
    batches.length === 0
      ? [{ ...deletions }]
      : batches.map((batch, index) => ({
          pages: batch,
          ...meta,
          digests: Object.fromEntries(
            Object.keys(batch).map((stored) => {
              const [page, screen = '1'] = stored.split('.');
              return [stored, digests.get(`${page}.${screen}`) ?? null];
            }),
          ),
          // Where each screen came from, only for screens that have a source.
          sources: Object.fromEntries(
            Object.keys(batch).flatMap((stored) => {
              const source = readSource(live.sources?.[stored]);
              return source == null ? [] : [[stored, source]];
            }),
          ),
          ...(index === batches.length - 1 ? deletions : {}),
        }));

  for (const body of posts) {
    const response = await fetch('/api/snapshot', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) throw new Error('Signed out — sign in again to keep the backup current.');
    if (!response.ok) throw new Error(`The backup refused a save (${response.status}).`);
  }
}

/**
 * The mirror's working state and its two moves — wait, then compare and send —
 * as a plain object: timers and in-flight flags are not React state, and
 * nothing on screen renders from them except through `setStatus`.
 */
function createMirror() {
  const m = {
    live: { pages: {}, titles: {}, kinds: {}, descriptions: {}, counts: {}, sources: {} } as LiveChannels,
    copy: null as CopyIndex | null,
    confirmed: new Set<number>(),
    timer: null as ReturnType<typeof setTimeout> | null,
    pendingSince: null as number | null,
    running: false,
    again: false,

    schedule(delay: number) {
      const now = Date.now();
      m.pendingSince ??= now;
      // Waited long enough while edits kept coming: go now.
      const wait = now - m.pendingSince >= MAX_WAIT_MS ? 0 : delay;
      if (m.timer != null) clearTimeout(m.timer);
      m.timer = setTimeout(() => {
        m.timer = null;
        void m.run();
      }, wait);
    },

    stop() {
      if (m.timer != null) clearTimeout(m.timer);
      m.timer = null;
    },

    /** Hold the latest channels, to be read when the timer fires. */
    setLive(live: LiveChannels) {
      m.live = live;
    },

    /** Stop trusting the copy's list: it is read again before the next send. */
    forget() {
      m.copy = null;
      m.pendingSince = null;
    },

    confirm(pages: readonly number[]) {
      for (const page of pages) m.confirmed.add(page);
    },

    async run() {
      if (m.running) {
        m.again = true;
        return;
      }
      m.running = true;
      m.pendingSince = null;
      try {
        m.copy ??= await fetchIndex();
        const snapshot = m.live;
        const screens = liveScreens(snapshot);
        const plan = planMirror(screens, m.copy, { confirmed: m.confirmed });

        if (isEmptyPlan(plan)) {
          setStatus({ phase: 'synced', pending: 0, held: plan.held, lastSynced: Date.now(), error: null });
          return;
        }

        setStatus({ phase: 'saving', pending: plan.upserts.length, held: plan.held, error: null });
        const digests = new Map([...screens].map(([key, screen]) => [key, screen.digest]));
        await sendPlan(plan, snapshot, digests);
        m.copy = applyMirrorPlan(m.copy, plan, screens);
        for (const page of plan.removed) m.confirmed.delete(page);
        setStatus({ phase: 'synced', pending: 0, held: plan.held, lastSynced: Date.now(), error: null });
      } catch (error) {
        // What landed is unknown, so the copy's list is read again next time
        // rather than trusted.
        m.copy = null;
        setStatus({
          phase: 'error',
          error: error instanceof Error ? error.message : 'The backup could not be reached.',
        });
        m.schedule(RETRY_MS);
      } finally {
        m.running = false;
        if (m.again) {
          m.again = false;
          m.schedule(QUIET_MS);
        }
      }
    },
  };
  return m;
}

/**
 * Mounted once, for a moderator. Renders nothing; keeps the copy current.
 */
export function LiveMirror() {
  const { isLoading } = usePlayContext();
  const [pages] = usePageData<Record<string, unknown>>(PAGES_CHANNEL, {});
  const [titles] = usePageData<Record<string, unknown>>(TITLES_CHANNEL, {});
  const [kinds] = usePageData<PageKinds>(PAGE_KINDS_CHANNEL, {});
  const [descriptions] = usePageData<Record<string, unknown>>(DESCRIPTIONS_CHANNEL, {});
  const [counts] = usePageData<SubpageCounts>(SUBPAGE_COUNTS_CHANNEL, {});
  const [sources] = usePageData<PageSources>(SOURCES_CHANNEL, {});
  const [mirror] = useState(createMirror);

  const onLiveHost = typeof location !== 'undefined' && location.hostname === LIVE_HOST;
  const active = onLiveHost && !isLoading;

  useEffect(() => {
    if (!onLiveHost) {
      setStatus({ phase: 'wrong-host' });
      return;
    }
    if (isLoading) {
      setStatus({ phase: 'waiting' });
      return;
    }
    controls = {
      resync: () => {
        mirror.forget();
        mirror.schedule(0);
      },
      confirmHeld: () => {
        mirror.confirm(status.held);
        mirror.schedule(0);
      },
    };
    void loadDailyStatus();
    const refresh = setInterval(() => {
      mirror.forget();
      mirror.schedule(0);
      void loadDailyStatus();
    }, REFRESH_MS);
    return () => {
      controls = null;
      clearInterval(refresh);
      mirror.stop();
      setStatus({ phase: 'off' });
    };
  }, [onLiveHost, isLoading, mirror]);

  // Any change to any channel: hold the latest, wait for it to settle, then
  // compare and send. Read when the timer fires rather than on every edit —
  // fingerprinting every page on every keystroke would be wasted work.
  useEffect(() => {
    mirror.setLive({
      pages: pages ?? {},
      titles: titles ?? {},
      kinds: kinds ?? {},
      descriptions: descriptions ?? {},
      counts: counts ?? {},
      sources: sources ?? {},
    });
    if (active) mirror.schedule(QUIET_MS);
  }, [active, mirror, pages, titles, kinds, descriptions, counts, sources]);

  return null;
}
