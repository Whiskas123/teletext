/**
 * Translating a page's runs with Claude — shared by `/api/snapshot?translate`
 * (the Translate button in /manage) and `scripts/translatePage.ts`.
 *
 * One request per page, not per run: sentences wrap across rows, so the model
 * needs the whole page to translate any line of it. The reply is a list of
 * `{ id, text }`, the same small schema for every page: one required property
 * per run made the API refuse page 187 (72 runs) as "compiled grammar is too
 * large". So a reply that skips a run is caught here, by `byId`, not by the API.
 *
 * Needs `ANTHROPIC_API_KEY`. On Vercel that means setting it in the project's
 * environment; it is read here, server side, and never reaches a browser.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { SubtitleRun } from '../../src/domain/subtitles';

export const TRANSLATION_MODEL = 'claude-opus-5-5';

/** $ per million tokens, input / output, for the cost the script prints. */
export const TRANSLATION_PRICE = { input: 4, output: 20 };

const SYSTEM = `You translate Portuguese teletext pages (RTP and SIC, 1990s–2000s) into English.

A page is a 40×24 grid, and every piece of text has a fixed number of cells.
You get the page's text cut into segments, each with its row, column and the
most characters it may hold. Return one English translation per segment id.

- Never exceed a segment's "max". Count every character, spaces included.
  Prefer the natural word that fits; abbreviate the way teletext did
  (Mon, Jan, pts, min, govt, nat.) only when it must.
- Segments on consecutive rows are often one sentence wrapped across lines.
  Translate the sentence, then share its words out across those segments in
  order; each still keeps its own limit.
- Keep names of people, places, teams, parties and programmes as they are.
  Keep every number, price, time and score exactly, in the same place.
  Dotted leaders (......) are layout: keep them, so prices stay lined up.
- Match the source's case: an all-caps heading stays all caps.
- A segment that is already English, or only a name, comes back unchanged.
- The segment with id "title" is not on the grid: it is the page's name as the
  directory lists it. Translate it as a short listing name, same case.`;

/** The reply's translations keyed by segment id; throws if any id is missing. */
export function byId(reply: { translations: { id: string; text: string }[] }, ids: readonly string[]): Record<string, string> {
  const found = Object.fromEntries(reply.translations.map((t) => [t.id, t.text]));
  const missing = ids.filter((id) => typeof found[id] !== 'string');
  if (missing.length > 0) throw new Error(`Reply skipped ${missing.length} segment(s): ${missing.join(', ')}`);
  return found;
}

export function isTranslationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Room for a title in the directory; it is not on the grid, so this is a courtesy. */
const TITLE_MAX = 40;

export interface Translation {
  english: string[];
  /** The page's title in English, when one was given. */
  title?: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * One English string per run, in order.
 *
 * `timeoutMs` exists for the API route: a Vercel function is killed at its
 * `maxDuration`, and an answer the moderator never sees is worse than a clear
 * "took too long" they can retry. No retries for the same reason.
 */
export async function translateRuns(
  runs: readonly SubtitleRun[],
  { timeoutMs, title }: { timeoutMs?: number; title?: string } = {},
): Promise<Translation> {
  const client = new Anthropic(timeoutMs == null ? {} : { timeout: timeoutMs, maxRetries: 0 });
  const segments = runs.map((run, i) => ({
    id: `s${i}`,
    row: run.row,
    col: run.start,
    max: run.room - run.start,
    text: run.text,
  }));
  // The title rides along in the same request: it names what the runs say, and
  // a second call per page would double the wait for one short string.
  const named = title != null && title.trim() !== '';
  const titled = named
    ? [...segments, { id: 'title', max: Math.max(TITLE_MAX, title.length), text: title }]
    : segments;
  const schema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, text: { type: 'string' } },
          required: ['id', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['translations'],
    additionalProperties: false,
  };

  const response = await client.beta.messages.create({
    model: TRANSLATION_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(titled) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Declined: ${response.stop_details?.explanation ?? 'no reason given'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Reply cut off at max_tokens');
  const text = response.content.find((block) => block.type === 'text');
  if (text?.type !== 'text') throw new Error('No text in the reply');

  const parsed = byId(JSON.parse(text.text), titled.map((s) => s.id));
  return {
    english: segments.map((s) => parsed[s.id]),
    ...(named ? { title: parsed.title.trim() } : {}),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
