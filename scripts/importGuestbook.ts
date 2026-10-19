/**
 * `bun run db:import-guestbook <file> [<file> …]` — put recovered signatures
 * into `guestbook_entries`.
 *
 * The signatures written before October 2026 lived only in the old playhtml
 * room, which can no longer be opened. What survives of them comes back as
 * JSON files in one of two shapes, both accepted:
 *
 * - `{ entries: [...] }` — `room:salvage`'s `.guestbook.json`, or a browser's
 *   cached copy exported with a little wrapper around it;
 * - `[...]` — a bare list, as the cache itself stores it.
 *
 * Every entry is repaired or rejected by the same rules the page reads with
 * (`normalizeEntry`), and keeps its own id and date. An id already in the table
 * is left alone, so files may overlap and the import can be run again.
 */

import { readFileSync } from 'node:fs';

import { db } from '../api/_lib/db';
import { compactSnippet, normalizeEntry, type GuestbookEntry } from '../src/domain/guestbook';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: bun run db:import-guestbook <file.json> [<file.json> …]');
  process.exit(1);
}

const found = new Map<string, GuestbookEntry>();
let unreadable = 0;
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const list = Array.isArray(parsed) ? parsed : ((parsed as { entries?: unknown })?.entries ?? []);
  for (const raw of Array.isArray(list) ? list : []) {
    const entry = normalizeEntry(raw);
    if (entry == null) unreadable += 1;
    else found.set(entry.id, entry);
  }
  console.log(`${file}: ${Array.isArray(list) ? list.length : 0} entries`);
}

let added = 0;
for (const entry of found.values()) {
  const rows = await db()`
    insert into guestbook_entries (id, name, author_id, cells, ts)
    values (${entry.id}, ${entry.name}, ${entry.authorId}, ${JSON.stringify(compactSnippet(entry.cells))}::jsonb, ${entry.ts})
    on conflict (id) do nothing
    returning id
  `;
  added += rows.length;
}

console.log(`${found.size} distinct signatures read, ${unreadable} unreadable skipped`);
console.log(`${added} added, ${found.size - added} already there`);
process.exit(0);
