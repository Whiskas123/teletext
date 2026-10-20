/**
 * Translating a page's runs with Claude — shared by `/api/snapshot?translate`
 * (the Translate button in /manage) and `scripts/translatePage.ts`.
 *
 * One request per page, not per run: sentences wrap across rows, so the model
 * needs the whole page to translate any line of it. The structured-output
 * schema has one required property per run, so a reply that skips one is
 * refused by the API rather than discovered here.
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
- A segment that is already English, or only a name, comes back unchanged.`;

export function isTranslationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface Translation {
  english: string[];
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
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<Translation> {
  const client = new Anthropic(timeoutMs == null ? {} : { timeout: timeoutMs, maxRetries: 0 });
  const segments = runs.map((run, i) => ({
    id: `s${i}`,
    row: run.row,
    col: run.start,
    max: run.end - run.start,
    text: run.text,
  }));
  const schema = {
    type: 'object',
    properties: Object.fromEntries(segments.map((s) => [s.id, { type: 'string' }])),
    required: segments.map((s) => s.id),
    additionalProperties: false,
  };

  const response = await client.beta.messages.create({
    model: TRANSLATION_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(segments) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Declined: ${response.stop_details?.explanation ?? 'no reason given'}`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Reply cut off at max_tokens');
  const text = response.content.find((block) => block.type === 'text');
  if (text?.type !== 'text') throw new Error('No text in the reply');

  const parsed = JSON.parse(text.text) as Record<string, string>;
  return {
    english: segments.map((s) => parsed[s.id]),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
