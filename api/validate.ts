const TOTAL_CELLS = 40 * 24;
const VALID_COLORS = new Set(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']);

function validColor(v: unknown): boolean {
  return typeof v === 'string' && VALID_COLORS.has(v);
}

/**
 * Returns true if body looks like a valid TeletextPage (array of TOTAL_CELLS cells with char, fg, bg).
 */
export function isValidPageBody(body: unknown): boolean {
  if (!Array.isArray(body) || body.length !== TOTAL_CELLS) return false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (!c || typeof c !== 'object') return false;
    const o = c as Record<string, unknown>;
    if (typeof o.char !== 'string') return false;
    if (!validColor(o.fg) || !validColor(o.bg)) return false;
  }
  return true;
}

export function emptyPageJson(): string {
  const cell = { char: ' ', fg: 'white', bg: 'black', graphics: null };
  const page = Array.from({ length: TOTAL_CELLS }, () => ({ ...cell }));
  return JSON.stringify(page);
}
