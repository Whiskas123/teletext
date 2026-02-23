/**
 * Seed content for pages 300 (WORLD) and 400 (FINANCE) when not yet saved.
 * Each page is 40×24 cells: { char, fg, bg, graphics?, graphicsColors? }.
 */
const COLS = 40;
const ROWS = 24;
const TOTAL = COLS * ROWS;

type Color = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';
interface Cell {
  char: string;
  fg: Color;
  bg: Color;
  graphics?: number | null;
  graphicsColors?: Color[];
}

function emptyCell(): Cell {
  return { char: ' ', fg: 'white', bg: 'black', graphics: null };
}

function idx(col: number, row: number): number {
  return row * COLS + col;
}

function fillPage(): Cell[] {
  return Array.from({ length: TOTAL }, () => ({ ...emptyCell() }));
}

function text(page: Cell[], col: number, row: number, str: string, fg: Color = 'white'): void {
  for (let i = 0; i < str.length && col + i < COLS; i++) {
    const k = idx(col + i, row);
    if (k >= 0 && k < TOTAL) page[k] = { ...page[k], char: str[i], fg, bg: 'black', graphics: null };
  }
}

/** Sixel: 63 = full block. Used for simple graphics. */
function block(page: Cell[], col: number, row: number, pattern: number, fg: Color = 'white'): void {
  const k = idx(col, row);
  if (k >= 0 && k < TOTAL)
    page[k] = { char: ' ', fg, bg: 'black', graphics: pattern & 0x3f, graphicsColors: [fg, fg, fg, fg, fg, fg] };
}

function worldPage(): Cell[] {
  const p = fillPage();
  // Title
  text(p, 12, 2, 'WORLD NEWS', 'yellow');
  text(p, 10, 3, '==========', 'yellow');
  // Simple globe / map outline (sixel blocks)
  const cy = 7;
  const cx = 18;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const d = (dx * dx) / 9 + (dy * dy) / 4;
      if (d <= 1.1) block(p, cx + dx, cy + dy, 63, 'cyan');
    }
  }
  block(p, 17, 6, 63, 'green');
  block(p, 19, 7, 63, 'green');
  block(p, 20, 5, 63, 'yellow');
  // Headlines
  text(p, 2, 10, 'EU summit agrees new climate targets', 'green');
  text(p, 2, 11, 'Asia markets mixed; tech shares rise', 'white');
  text(p, 2, 12, 'UN calls for ceasefire in region', 'cyan');
  text(p, 2, 14, 'Weather: Rain in the north, sun south', 'yellow');
  text(p, 2, 15, 'Sport: World Cup qualifiers tonight', 'white');
  text(p, 2, 17, 'More news on pages 301-399', 'magenta');
  return p;
}

function financePage(): Cell[] {
  const p = fillPage();
  // Title
  text(p, 12, 2, 'FINANCE', 'cyan');
  text(p, 10, 3, '=======', 'cyan');
  // Simple bar chart (sixel blocks)
  const baseRow = 6;
  const bars = [
    { col: 4, h: 4, fg: 'green' as Color },
    { col: 8, h: 2, fg: 'red' as Color },
    { col: 12, h: 5, fg: 'green' as Color },
    { col: 16, h: 3, fg: 'yellow' as Color },
    { col: 20, h: 1, fg: 'red' as Color },
    { col: 24, h: 4, fg: 'cyan' as Color },
    { col: 28, h: 2, fg: 'white' as Color },
  ];
  for (const b of bars) {
    for (let r = 0; r < b.h; r++) block(p, b.col, baseRow + 4 - r, 63, b.fg);
  }
  text(p, 2, 11, 'INDEX    TODAY    CHANGE', 'yellow');
  text(p, 2, 12, 'PSI 20   5,234   +0.8%', 'white');
  text(p, 2, 13, 'EURO STOXX 4,891   -0.2%', 'white');
  text(p, 2, 14, 'NASDAQ  14,221   +1.1%', 'green');
  text(p, 2, 16, 'CURRENCIES', 'cyan');
  text(p, 2, 17, 'EUR/USD  1.0842  EUR/GBP  0.861', 'white');
  text(p, 2, 19, 'Rates: ECB holds at 4.00%', 'magenta');
  text(p, 2, 20, 'Full data on pages 401-499', 'magenta');
  return p;
}

export function getSeedPage(num: number): string | null {
  if (num === 300) return JSON.stringify(worldPage());
  if (num === 400) return JSON.stringify(financePage());
  return null;
}
