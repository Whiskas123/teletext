/**
 * Page store: Redis (Vercel Marketplace) when REDIS_URL is set,
 * otherwise file-based (so data persists across requests in local dev).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createClient, type RedisClientType } from 'redis';

const PAGE_NUMBERS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const TOTAL_CELLS = 40 * 24;

export type TeletextPage = unknown[]; // validated at API boundary

function key(num: number): string {
  return `page:${num}`;
}

function getFileStoreDir(): string {
  if (process.env.VERCEL === '1') {
    return '/tmp/teletext-pages';
  }
  return join(process.cwd(), '.teletext-pages');
}

async function getFromFile(num: number): Promise<string | null> {
  try {
    const dir = getFileStoreDir();
    await mkdir(dir, { recursive: true });
    const raw = await readFile(join(dir, `page-${num}.json`), 'utf-8');
    return raw ?? null;
  } catch {
    return null;
  }
}

async function setInFile(num: number, value: string): Promise<void> {
  const dir = getFileStoreDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `page-${num}.json`), value, 'utf-8');
}

export function isValidPageNumber(n: unknown): n is (typeof PAGE_NUMBERS)[number] {
  return typeof n === 'number' && PAGE_NUMBERS.includes(n as (typeof PAGE_NUMBERS)[number]);
}

export function getPageNumbers(): readonly number[] {
  return PAGE_NUMBERS;
}

let _redis: RedisClientType | null = null;

async function getRedis(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (_redis?.isOpen) return _redis;
  try {
    _redis = createClient({ url });
    await _redis.connect();
    return _redis;
  } catch {
    _redis = null;
    return null;
  }
}

async function getFromRedis(num: number): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get(key(num));
    return v ?? null;
  } catch {
    return null;
  }
}

async function setInRedis(num: number, value: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.set(key(num), value);
}

export async function getPage(num: number): Promise<string | null> {
  if (process.env.REDIS_URL) {
    return getFromRedis(num);
  }
  return getFromFile(num);
}

export async function setPage(num: number, value: string): Promise<void> {
  if (process.env.REDIS_URL) {
    await setInRedis(num, value);
  } else {
    await setInFile(num, value);
  }
}

export async function getAllPages(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (process.env.REDIS_URL) {
    const redis = await getRedis();
    if (redis) {
      try {
        const keys = PAGE_NUMBERS.map((n) => key(n));
        const values = await redis.mGet(keys);
        PAGE_NUMBERS.forEach((n, i) => {
          result[String(n)] = values[i] ?? '';
        });
      } catch {
        PAGE_NUMBERS.forEach((n) => {
          result[String(n)] = '';
        });
      }
    }
  } else {
    for (const num of PAGE_NUMBERS) {
      const raw = await getFromFile(num);
      result[String(num)] = raw ?? '';
    }
  }
  return result;
}

export { TOTAL_CELLS };
