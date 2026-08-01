/**
 * Static checks on the SQL migrations.
 *
 * These exist because of a bug that got all the way to production data: a CHECK
 * constraint written as `thumbnail ~ '^[0-7]{960}$'`. Postgres's regex engine
 * caps bounded repetition at 255 and rejects anything larger, but the failure
 * was invisible until the first row was written — `ADD COLUMN` left every value
 * NULL, and `thumbnail is null` short-circuits before the regex is evaluated,
 * so the migration itself succeeded and the backfill was what fell over.
 *
 * JavaScript has no such limit, which is exactly why it looked correct: the
 * same pattern works in `domain/thumbnail.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

/** Postgres rejects `{n}` / `{n,m}` above this in a POSIX regex. */
const MAX_PG_REPETITION = 255;

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
    }));
}

/** Migration text with `--` comments removed, so prose about a bug is not read as the bug. */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

describe('SQL migrations', () => {
  it('has at least one migration to check', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('never uses a regex repetition Postgres cannot count to', () => {
    for (const { name, sql } of migrationFiles()) {
      const counts = [...withoutComments(sql).matchAll(/\{(\d+)(?:,(\d+))?\}/g)];
      for (const match of counts) {
        const upper = Number(match[2] ?? match[1]);
        expect(
          upper,
          `${name}: '${match[0]}' exceeds Postgres's ${MAX_PG_REPETITION} repetition limit — ` +
            'use length() for the size and a regex only for the alphabet',
        ).toBeLessThanOrEqual(MAX_PG_REPETITION);
      }
    }
  });

  it('numbers migrations uniquely and in order', () => {
    // Applied in filename order and recorded by name, so a duplicate prefix
    // would make the order ambiguous between machines.
    const prefixes = migrationFiles().map(({ name }) => name.slice(0, 3));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect([...prefixes].sort()).toEqual(prefixes);
  });

  it('keeps every statement re-runnable', () => {
    // scripts/migrate.ts records what it has applied, but a half-applied file
    // that is fixed and re-run should not fail on the parts that succeeded.
    for (const { name, sql } of migrationFiles()) {
      const body = withoutComments(sql).toLowerCase();
      for (const [pattern, guard] of [
        [/create table (?!if not exists)/, 'create table if not exists'],
        [/create index (?!if not exists)/, 'create index if not exists'],
        [/add column (?!if not exists)/, 'add column if not exists'],
      ] as const) {
        expect(pattern.test(body), `${name}: use '${guard}'`).toBe(false);
      }
    }
  });
});
