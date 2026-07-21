/**
 * Seed page content + titles for the one-time import into the Playhtml_Store.
 *
 * Pages contain both text and block graphics (teletext 2×3 sixels).
 * Sixel bitmask per cell: bit0=top-left, bit1=mid-left, bit2=bot-left,
 *                          bit3=top-right, bit4=mid-right, bit5=bot-right.
 * graphicsColors is a 6-element array matching positions [0..5].
 */

import { COLS, type Cell, type SixelColors, type TeletextColor } from '../types/teletext';
import type { PageCellMap } from './types';

function idx(row: number, col: number): number {
  return row * COLS + col;
}

function text(
  map: PageCellMap,
  row: number,
  col: number,
  str: string,
  fg: TeletextColor = 'white',
  bg: TeletextColor = 'black',
): void {
  for (let i = 0; i < str.length && col + i < COLS; i++) {
    map[idx(row, col + i)] = { char: ' ', fg, bg, graphics: null };
    // use char for actual character
    (map[idx(row, col + i)] as Cell).char = str[i];
  }
}

function bar(map: PageCellMap, row: number, bg: TeletextColor): void {
  for (let c = 0; c < COLS; c++) {
    map[idx(row, c)] = { char: ' ', fg: 'white', bg, graphics: null };
  }
}

function centre(
  map: PageCellMap,
  row: number,
  str: string,
  fg: TeletextColor = 'white',
  bg: TeletextColor = 'black',
): void {
  const col = Math.max(0, Math.floor((COLS - str.length) / 2));
  text(map, row, col, str, fg, bg);
}

function heading(
  map: PageCellMap,
  barColor: TeletextColor,
  title: string,
  titleFg: TeletextColor,
): void {
  bar(map, 1, barColor);
  centre(map, 1, title, titleFg, barColor);
}

/**
 * Place a single graphics cell.
 * pattern: 0-63 sixel bitmask.
 * colors: array of 6 TeletextColor values for positions [0..5].
 * bg: background color for unlit sub-pixels.
 */
function gfx(
  map: PageCellMap,
  row: number,
  col: number,
  pattern: number,
  colors: SixelColors,
  bg: TeletextColor = 'black',
): void {
  map[idx(row, col)] = {
    char: ' ',
    fg: colors[0],
    bg,
    graphics: pattern & 0x3f,
    graphicsColors: colors,
  };
}

/** Fill a rectangle of solid-color graphics cells (pattern=63 = all bits set). */
function gfxRect(
  map: PageCellMap,
  rowStart: number,
  colStart: number,
  rows: number,
  cols: number,
  color: TeletextColor,
  bg: TeletextColor = 'black',
): void {
  const solidColors: SixelColors = [color, color, color, color, color, color];
  for (let r = rowStart; r < rowStart + rows; r++) {
    for (let c = colStart; c < colStart + cols; c++) {
      gfx(map, r, c, 63, solidColors, bg);
    }
  }
}

/** Draw a horizontal line of half-cells (top half filled = bits 3,4 = 0b110000 = 48). */
function gfxHLine(
  map: PageCellMap,
  row: number,
  colStart: number,
  length: number,
  color: TeletextColor,
  bg: TeletextColor = 'black',
): void {
  const c: SixelColors = [color, color, color, color, color, color];
  for (let i = 0; i < length; i++) {
    // top half: bits 3 (top-left) and 0... wait, corrected mapping:
    // bit0=top-left, bit3=top-right → top half = bits 0 and 3 = 0b001001 = 9
    // mid half = bits 1 and 4 = 0b010010 = 18
    // bot half = bits 2 and 5 = 0b100100 = 36
    gfx(map, row, colStart + i, 9, c, bg); // top strip
  }
}

// ─── Page 100: Main Index — pixel-art TV set ─────────────────────────────────

function buildIndex(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'red', '  T E L E T E X T  H O U S E  ', 'white');

  // TV body outline — cyan rectangle rows 3-8, cols 4-17
  gfxRect(m, 3, 4, 1, 14, 'cyan');          // top edge
  gfxRect(m, 4, 4, 4, 1, 'cyan');           // left edge
  gfxRect(m, 4, 17, 4, 1, 'cyan');          // right edge
  gfxRect(m, 8, 4, 1, 14, 'cyan');          // bottom edge
  // TV screen (yellow fill inside)
  gfxRect(m, 4, 5, 4, 12, 'yellow', 'black');
  // TV antenna
  gfx(m, 2, 8,  0b100100, ['cyan','cyan','cyan','cyan','cyan','cyan'], 'black'); // bot-left + bot-right
  gfx(m, 2, 13, 0b100100, ['cyan','cyan','cyan','cyan','cyan','cyan'], 'black');
  // TV stand / base
  gfxRect(m, 9, 9, 1, 4, 'cyan');

  centre(m, 3, 'MAIN INDEX', 'yellow', 'red');

  // Directory entries
  text(m, 11, 5, '100', 'white', 'black');
  text(m, 11, 10, 'Main Index', 'cyan', 'black');
  text(m, 12, 5, '200', 'white', 'black');
  text(m, 12, 10, 'TV Guide', 'green', 'black');
  text(m, 13, 5, '300', 'white', 'black');
  text(m, 13, 10, 'World News', 'yellow', 'black');
  text(m, 14, 5, '400', 'white', 'black');
  text(m, 14, 10, 'Finance', 'cyan', 'black');
  text(m, 15, 5, '500', 'white', 'black');
  text(m, 15, 10, 'Weather', 'green', 'black');
  text(m, 16, 5, '600', 'white', 'black');
  text(m, 16, 10, 'Sport', 'magenta', 'black');

  centre(m, 19, 'Use the remote to request a page', 'white', 'black');
  centre(m, 20, 'The room votes on what to watch', 'cyan', 'black');

  return m;
}

// ─── Page 200: TV Guide — schedule grid ──────────────────────────────────────

function buildTvGuide(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'green', 'TV GUIDE', 'black');
  centre(m, 3, "TONIGHT'S SCHEDULE", 'yellow', 'black');

  // Decorative border — top
  gfxRect(m, 4, 1, 1, 38, 'green');

  const times  = ['18:00', '18:30', '19:00', '20:00', '21:00', '22:00', '22:30'];
  const shows  = [
    'Evening News        ',
    'Local Weather       ',
    'Quiz Night Live     ',
    'Film: Retro Dreams  ',
    'Documentary: Pixels ',
    'Late Night News     ',
    'Sign Off            ',
  ];
  const colors: TeletextColor[] = ['cyan','cyan','yellow','white','white','cyan','cyan'];

  for (let i = 0; i < times.length; i++) {
    const row = 5 + i;
    // time column
    text(m, row, 2, times[i], 'green', 'black');
    // separator dot
    text(m, row, 8, '|', 'white', 'black');
    // show title
    text(m, row, 10, shows[i], colors[i], 'black');
  }

  // Decorative border — bottom
  gfxRect(m, 13, 1, 1, 38, 'green');

  text(m, 15, 4, 'KEY:', 'yellow', 'black');
  text(m, 15, 10, 'News', 'cyan', 'black');
  text(m, 15, 18, 'Entertainment', 'white', 'black');

  centre(m, 17, '300 News   400 Finance   500 Weather', 'green', 'black');

  // Small TV icon (right side)
  gfxRect(m, 5, 33, 1, 5, 'cyan');
  gfxRect(m, 6, 33, 3, 1, 'cyan');
  gfxRect(m, 6, 37, 3, 1, 'cyan');
  gfxRect(m, 9, 33, 1, 5, 'cyan');
  gfxRect(m, 6, 34, 3, 3, 'yellow', 'black');

  return m;
}

// ─── Page 300: World News — globe graphic ────────────────────────────────────

function buildWorldNews(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'blue', 'WORLD NEWS', 'white');

  // Globe — rough circle in block graphics, cols 1-8, rows 2-9
  // Top arc
  const g: TeletextColor = 'cyan';
  const w: TeletextColor = 'blue';
  const solidG: SixelColors = [g,g,g,g,g,g];
  const solidW: SixelColors = [w,w,w,w,w,w];

  // Row 2 — top of globe (partial arc)
  gfx(m, 2, 3,  0b001001, solidG, 'black'); // top strip
  gfx(m, 2, 4,  63,       solidG, 'black');
  gfx(m, 2, 5,  63,       solidG, 'black');
  gfx(m, 2, 6,  0b001001, solidG, 'black');

  // Rows 3-7 — globe body
  for (let r = 3; r <= 7; r++) {
    gfx(m, r, 2,  63, solidG, 'black');
    gfx(m, r, 3,  63, solidW, 'black'); // longitude lines (darker)
    gfx(m, r, 4,  63, solidG, 'black');
    gfx(m, r, 5,  63, solidW, 'black');
    gfx(m, r, 6,  63, solidG, 'black');
    gfx(m, r, 7,  63, solidG, 'black');
  }
  // latitude stripe
  gfxRect(m, 5, 2, 1, 6, 'white');

  // Row 8 — bottom arc
  gfx(m, 8, 3,  0b100100, solidG, 'black');
  gfx(m, 8, 4,  63,       solidG, 'black');
  gfx(m, 8, 5,  63,       solidG, 'black');
  gfx(m, 8, 6,  0b100100, solidG, 'black');

  // Headlines (right of globe)
  text(m, 2, 11, 'BREAKING', 'red', 'black');
  bar(m, 3, 'black');
  text(m, 4, 11, 'Teletext makes a comeback', 'yellow', 'black');
  text(m, 5, 11, 'as retro tech fans rejoice', 'yellow', 'black');
  text(m, 7, 11, 'Tech giants invest in', 'white', 'black');
  text(m, 8, 11, 'retro broadcast systems', 'white', 'black');

  bar(m, 10, 'blue');
  centre(m, 10, 'MORE HEADLINES', 'white', 'blue');
  text(m, 12, 4, 'World markets rally — see page 400', 'green', 'black');
  text(m, 13, 4, 'Weather outlook — see page 500     ', 'cyan', 'black');
  text(m, 14, 4, 'Sports round-up — see page 600     ', 'yellow', 'black');

  centre(m, 17, 'Next story: 301', 'cyan', 'black');

  return m;
}

// ─── Page 400: Finance — bar chart ───────────────────────────────────────────

function buildFinance(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'cyan', 'FINANCE', 'black');
  centre(m, 3, 'MARKETS AT A GLANCE', 'yellow', 'black');

  // Market data
  text(m, 5,  2, 'FTSE 100', 'white', 'black');
  text(m, 5, 14, '7,502', 'white', 'black');
  text(m, 5, 22, '+12  ', 'green', 'black');
  gfxRect(m, 5, 27, 1, 8, 'green'); // bar

  text(m, 6,  2, 'DOW JONES', 'white', 'black');
  text(m, 6, 14, '34,120', 'white', 'black');
  text(m, 6, 22, '-45  ', 'red', 'black');
  gfxRect(m, 6, 27, 1, 5, 'red');

  text(m, 7,  2, 'NASDAQ', 'white', 'black');
  text(m, 7, 14, '14,230', 'white', 'black');
  text(m, 7, 22, '+30  ', 'green', 'black');
  gfxRect(m, 7, 27, 1, 7, 'green');

  text(m, 8,  2, 'NIKKEI', 'white', 'black');
  text(m, 8, 14, '29,800', 'white', 'black');
  text(m, 8, 22, '-120 ', 'red', 'black');
  gfxRect(m, 8, 27, 1, 3, 'red');

  bar(m, 10, 'blue');
  centre(m, 10, 'CURRENCIES', 'yellow', 'blue');

  text(m, 11, 2, 'GBP/USD', 'white', 'black'); text(m, 11, 12, '1.2741', 'green', 'black');
  text(m, 12, 2, 'EUR/USD', 'white', 'black'); text(m, 12, 12, '1.0923', 'yellow', 'black');
  text(m, 13, 2, 'USD/JPY', 'white', 'black'); text(m, 13, 12, '149.82', 'cyan', 'black');

  bar(m, 15, 'blue');
  centre(m, 15, 'COMMODITIES', 'yellow', 'blue');
  text(m, 16, 2, 'GOLD', 'yellow', 'black');  text(m, 16, 10, '$1,980/oz', 'white', 'black');
  text(m, 17, 2, 'OIL ', 'yellow', 'black');  text(m, 17, 10, '$82.40/bl', 'white', 'black');

  // Decorative coin stack (right side)
  gfxRect(m, 11, 28, 1, 8, 'yellow');
  gfxRect(m, 12, 28, 1, 8, 'yellow');
  gfxRect(m, 13, 27, 1, 9, 'yellow');
  gfxRect(m, 14, 27, 1, 9, 'yellow');

  return m;
}

// ─── Page 500: Weather — sun + cloud graphic ─────────────────────────────────

function buildWeather(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'yellow', 'WEATHER', 'black');
  centre(m, 3, 'FORECAST FOR TODAY', 'cyan', 'black');

  // Sun — yellow circle, cols 1-7, rows 2-8
  const y: TeletextColor = 'yellow';
  const solidY: SixelColors = [y,y,y,y,y,y];
  const r: TeletextColor = 'red';
  const solidR: SixelColors = [r,r,r,r,r,r];

  // Sun rays (top)
  gfx(m, 2, 2, 0b100100, solidY, 'black');
  gfx(m, 2, 4, 0b100100, solidY, 'black');
  gfx(m, 2, 6, 0b100100, solidY, 'black');
  // Sun body rows 3-7
  gfx(m, 3, 1, 0b001001, solidY, 'black');
  gfxRect(m, 3, 2, 1, 5, 'yellow');
  gfx(m, 3, 7, 0b001001, solidY, 'black');

  gfx(m, 4, 1, 63, solidY, 'black');
  gfxRect(m, 4, 2, 1, 5, 'red');   // hot core
  gfx(m, 4, 7, 63, solidY, 'black');

  gfx(m, 5, 1, 63, solidY, 'black');
  gfxRect(m, 5, 2, 1, 5, 'red');
  gfx(m, 5, 7, 63, solidY, 'black');

  gfx(m, 6, 1, 63, solidY, 'black');
  gfxRect(m, 6, 2, 1, 5, 'red');
  gfx(m, 6, 7, 63, solidY, 'black');

  gfxRect(m, 7, 2, 1, 5, 'yellow');
  // Sun rays (bottom)
  gfx(m, 8, 2, 0b001001, solidY, 'black');
  gfx(m, 8, 4, 0b001001, solidY, 'black');
  gfx(m, 8, 6, 0b001001, solidY, 'black');

  // Forecast table
  const cities   = ['LONDON ', 'PARIS  ', 'MADRID ', 'BERLIN ', 'LISBON ', 'NEW YORK'];
  const conds    = ['Sunny  ', 'Cloudy ', 'Hot    ', 'Showers', 'Clear  ', 'Windy  '];
  const temps    = ['21°C', '19°C', '34°C', '14°C', '28°C', '18°C'];
  const condFg: TeletextColor[] = ['yellow','cyan','red','blue','yellow','white'];

  for (let i = 0; i < cities.length; i++) {
    const row = 11 + i;
    text(m, row,  2, cities[i], 'white', 'black');
    text(m, row, 12, conds[i],  condFg[i], 'black');
    text(m, row, 22, temps[i],  'white', 'black');

    // mini weather icon
    const iconColor = condFg[i];
    const iconSolid: SixelColors = [iconColor,iconColor,iconColor,iconColor,iconColor,iconColor];
    gfx(m, row, 28, conds[i].trim() === 'Sunny' || conds[i].trim() === 'Clear' || conds[i].trim() === 'Hot' ? 63 : 0b011011, iconSolid, 'black');
  }

  bar(m, 18, 'blue');
  centre(m, 18, '3-DAY OUTLOOK: MAINLY FINE', 'yellow', 'blue');

  return m;
}

// ─── Page 600: Sport — football pitch + scores ───────────────────────────────

function buildSport(): PageCellMap {
  const m: PageCellMap = {};
  heading(m, 'magenta', 'SPORT', 'white');
  centre(m, 3, 'FOOTBALL RESULTS', 'yellow', 'black');

  // Mini football pitch (green rectangle), cols 20-38, rows 4-14
  gfxRect(m, 4, 20, 1, 18, 'white');          // top line
  gfxRect(m, 5, 20, 9, 1, 'white');           // left line
  gfxRect(m, 5, 37, 9, 1, 'white');           // right line
  gfxRect(m, 14, 20, 1, 18, 'white');         // bottom line
  gfxRect(m, 5, 21, 9, 16, 'green', 'black'); // grass
  // Centre circle (rough — just a white dot)
  gfx(m, 9, 28, 63, ['white','white','white','white','white','white'], 'green');
  // Centre line
  for (let r = 5; r <= 13; r++) {
    gfx(m, r, 28, 0b010010, ['white','white','white','white','white','white'], 'green');
  }
  // Goal posts
  gfxRect(m, 7, 20, 3, 1, 'yellow');
  gfxRect(m, 7, 37, 3, 1, 'yellow');

  // Results (left side)
  const results: [string, string, string][] = [
    ['United   ', '2 - 1', 'City     '],
    ['Rovers   ', '0 - 0', 'Athletic '],
    ['Albion   ', '3 - 2', 'Wanderers'],
    ['Palace   ', '1 - 1', 'Spurs    '],
    ['Wolves   ', '4 - 0', 'Vale     '],
  ];

  const scoreColors: TeletextColor[] = ['green','yellow','green','yellow','green'];

  for (let i = 0; i < results.length; i++) {
    const row = 5 + i;
    const [home, score, away] = results[i];
    text(m, row, 1, home,  'white', 'black');
    text(m, row, 10, score, scoreColors[i], 'black');
    text(m, row, 16, away,  'cyan', 'black');
  }

  bar(m, 11, 'blue');
  centre(m, 11, 'LEAGUE TABLE', 'yellow', 'blue');

  text(m, 13, 2, 'P W D L  Pts', 'cyan', 'black');
  text(m, 14, 2, '1  United      38 26 8  4  86', 'white', 'black');
  text(m, 15, 2, '2  City        38 25 7  6  82', 'white', 'black');
  text(m, 16, 2, '3  Albion      38 22 9  7  75', 'white', 'black');

  centre(m, 19, 'Tennis p.610   Cricket p.620', 'cyan', 'black');

  return m;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const SEED_PAGES: Readonly<Record<number, PageCellMap>> = {
  100: buildIndex(),
  200: buildTvGuide(),
  300: buildWorldNews(),
  400: buildFinance(),
  500: buildWeather(),
  600: buildSport(),
};

export const SEED_TITLES: Readonly<Record<number, string>> = {
  100: 'Main Index',
  200: 'TV Guide',
  300: 'World News',
  400: 'Finance',
  500: 'Weather',
  600: 'Sport',
};

export type { Cell };
