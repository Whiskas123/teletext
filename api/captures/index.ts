/**
 * `GET /api/captures` — browse the corpus.
 *
 * This is the selection surface. Page numbers were reused for unrelated content
 * over the years, so a number is not a version key and the ~4 captures sharing
 * one are usually different pages entirely. Choosing between them is a
 * curatorial act, and the filters here are the ones that support it: topic (the
 * on-disk folder division), era, source, and page number.
 *
 * ## Neither cells nor images are in the list
 *
 * A page's cells are ~59 KB, so returning them for sixty results would be three
 * and a half megabytes. The rendered images are far smaller (~2.2 KB) but are
 * still fetched one by one, as lazily-loaded `<img>` elements pointing at
 * `GET /api/captures/[id]?format=image` — that way the browser only downloads
 * what actually scrolls into view, and caches each one. The list carries
 * `has_image` so a capture with nothing stored can be shown as such rather
 * than as a broken image.
 *
 * ## Filling a service from three thousand captures
 *
 * Three more parameters, for working through the corpus rather than browsing it:
 *
 * - `unpublished=true` hides captures already on a page, so the list is what
 *   is left to do. Each row carries `published_to` either way (`"205/1"`),
 *   read from the live mirror's copy (`live_pages.source`) — a few seconds
 *   behind playhtml, which is why `/manage` also hides what it knows it just
 *   placed.
 * - `latest=true` shows one capture per page slot — its most recent day — with
 *   `versions` saying how many days were folded behind it.
 * - `sort=newest|oldest` for when era matters more than page number.
 *
 * Every row also carries `story_size`: how many screens its page had on the
 * day it was captured. `?story=<id>` returns those screens, in order, so a
 * multi-screen story can be picked whole.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { db } from '../_lib/db';
import { isAdmin } from '../_lib/auth';
import {
  fail,
  json,
  methodIs,
  queryInt,
  queryValue,
  serverError,
} from '../_lib/http';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!methodIs(req, res, 'GET')) return;

  if (!isAdmin(req)) {
    fail(res, 401, 'Sign in to browse the archive.');
    return;
  }

  try {
    const story = queryInt(req, 'story', 0, 0, Number.MAX_SAFE_INTEGER);
    if (story > 0) {
      json(res, 200, { captures: await storyOf(story) });
      return;
    }

    const source = queryValue(req, 'source');
    const topic = queryValue(req, 'topic');
    const topicGroup = queryValue(req, 'topicGroup');
    const scheme = queryValue(req, 'scheme');
    const search = queryValue(req, 'q');
    const page = queryInt(req, 'page', 0, 1, 999);
    const limit = queryInt(req, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = queryInt(req, 'offset', 0, 0, 100_000);
    // Undecoded captures are hidden by default — they cannot be published — but
    // remain reachable, since they are most of the SIC corpus and still worth
    // browsing while support for them is pending.
    const includeUndecoded = queryValue(req, 'undecoded') === 'true';
    // What is already on air, hidden — so the list is what is left to do.
    const unpublished = queryValue(req, 'unpublished') === 'true';
    // One capture per page slot: the most recent day. See the note on `latest`.
    const latest = queryValue(req, 'latest') === 'true';
    const sort = queryValue(req, 'sort') ?? 'page';

    /*
     * `latest` groups by page, screen *and topic*, not by page number alone.
     * RTP reused numbers — page 140 was Porto 2001's index one year and an SMS
     * service the next — so two captures of "140" in different topics are
     * different pages, and hiding one behind the other would lose it. Within
     * a topic, a later day of the same slot is usually the same page again (a
     * schedule, a timetable), and `versions` says how many are folded away.
     *
     * The published filter runs after the grouping: once a slot's capture is
     * on air, the slot is done, rather than its next-newest day taking its
     * place in the list.
     *
     * `total` rides along as a window count, so the filters are written once.
     */
    const rows = await db()`
      with filtered as (
        select
          id, source, original_page, sub, sub_index, topic, topic_group,
          topic_source, scheme, first_seen, last_seen, capture_count,
          tier, bucket, manifest_title, decode_status, profile,
          width, height, snapped_pixels, unknown_glyphs, corpus_file,
          (image is not null) as has_image
        from archive_captures
        where (${source ?? null}::text is null or source = ${source ?? null})
          and (${topic ?? null}::text is null or topic = ${topic ?? null})
          and (${topicGroup ?? null}::text is null or topic_group = ${topicGroup ?? null})
          and (${scheme ?? null}::text is null or scheme = ${scheme ?? null})
          and (${page === 0 ? null : page}::int is null
               or original_page = ${page === 0 ? null : page})
          and (${search ?? null}::text is null
               or manifest_title ilike '%' || ${search ?? null} || '%'
               or corpus_file ilike '%' || ${search ?? null} || '%')
          and (${includeUndecoded}::boolean or decode_status = 'ok')
      ),
      grouped as (
        select
          f.*,
          count(*) over slot as versions,
          row_number() over (slot order by last_seen desc nulls last, id desc) as rank
        from filtered f
        window slot as (partition by source, original_page, sub_index, topic)
      ),
      shown as (
        select g.*,
          coalesce(
            (select array_agg(l.page_number::text || '/' || l.subpage::text
                              order by l.page_number, l.subpage)
             from live_pages l
             where (l.source ->> 'captureId')::bigint = g.id),
            '{}'
          ) as published_to
        from grouped g
        where (not ${latest}::boolean or g.rank = 1)
      )
      select
        s.id, s.source, s.original_page, s.sub, s.sub_index, s.topic, s.topic_group,
        s.topic_source, s.scheme, s.first_seen, s.last_seen, s.capture_count,
        s.tier, s.bucket, s.manifest_title, s.decode_status, s.profile,
        s.width, s.height, s.snapped_pixels, s.unknown_glyphs, s.corpus_file,
        s.has_image, s.versions::int as versions, s.published_to,
        (select count(distinct o.sub_index)::int
         from archive_captures o
         where o.source = s.source
           and o.original_page = s.original_page
           and o.decode_status = 'ok'
           and o.first_seen::date <= coalesce(s.last_seen, s.first_seen)::date + 1
           and coalesce(o.last_seen, o.first_seen)::date >= s.first_seen::date - 1
        ) as story_size,
        count(*) over ()::int as total
      from shown s
      where (not ${unpublished}::boolean or cardinality(s.published_to) = 0)
      order by
        case when ${sort}::text = 'newest' then s.last_seen end desc nulls last,
        case when ${sort}::text = 'oldest' then s.first_seen end asc nulls last,
        s.original_page, s.sub_index nulls last, s.first_seen
      limit ${limit} offset ${offset}
    `;

    json(res, 200, {
      // The window count is on every row; it is the page's, not a capture's.
      captures: rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total')),
      ),
      total: rows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    serverError(res, 'captures/index', error);
  }
}

/**
 * Every screen of the story `id` belongs to: the captures of the same page on
 * the same source that were on air at the same time, one per screen, in order.
 *
 * "At the same time" is overlapping capture days, with a day's slack either
 * side, rather than an equal first day: a screen seen on several days has an
 * earlier `first_seen` than a sibling first caught on the last of them, and a
 * crawl that ran past midnight caught one story on two dates. Where a screen was captured more
 * than once in that window, the capture closest in time to `id` is the one.
 */
async function storyOf(id: number) {
  return db()`
    with target as (select * from archive_captures where id = ${id})
    select * from (
      select distinct on (c.sub_index)
        c.id, c.source, c.original_page, c.sub, c.sub_index, c.topic, c.topic_group,
        c.topic_source, c.scheme, c.first_seen, c.last_seen, c.capture_count,
        c.tier, c.bucket, c.manifest_title, c.decode_status, c.profile,
        c.width, c.height, c.snapped_pixels, c.unknown_glyphs, c.corpus_file,
        (c.image is not null) as has_image
      from archive_captures c, target t
      where c.source = t.source
        and c.original_page = t.original_page
        and (c.id = t.id or (
          c.decode_status = 'ok'
          and c.first_seen::date <= coalesce(t.last_seen, t.first_seen)::date + 1
          and coalesce(c.last_seen, c.first_seen)::date >= t.first_seen::date - 1
        ))
      order by c.sub_index, (c.id = t.id) desc,
        abs(extract(epoch from (c.first_seen - t.first_seen)))
    ) story
    order by sub_index nulls last
  `;
}
