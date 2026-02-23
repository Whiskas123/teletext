/**
 * Page store: Vercel KV when env is set, otherwise file-based (so data persists across requests in local dev).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { kv } from '@vercel/kv';

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

async function getFromKv(num: number): Promise<string | null> {
  try {
    const v = await kv.get<string>(key(num));
    return v ?? null;
  } catch {
    return null;
  }
}

async function setInKv(num: number, value: string): Promise<void> {
  await kv.set(key(num), value);
}

export async function getPage(num: number): Promise<string | null> {
  if (process.env.KV_REST_API_URL) {
    return getFromKv(num);
  }
  return getFromFile(num);
}

export async function setPage(num: number, value: string): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    await setInKv(num, value);
  } else {
    await setInFile(num, value);
  }
}

export async function getAllPages(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (process.env.KV_REST_API_URL) {
    try {
      const keys = PAGE_NUMBERS.map((n) => key(n));
      const values = await kv.mget<string>(...keys);
      PAGE_NUMBERS.forEach((n, i) => {
        result[String(n)] = values[i] ?? '';
      });
    } catch {
      PAGE_NUMBERS.forEach((n) => {
        result[String(n)] = '';
      });
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
