import type { DateRange, StatisticsBook } from './statistics';

export type PosterOutput = 'single' | 'pages' | 'long';
export type PosterBook = Pick<StatisticsBook, 'id' | 'title' | 'author' | 'coverUri' | 'milliseconds'>;
export interface PosterTile {
  book: PosterBook;
  x: number;
  y: number;
  width: number;
  height: number;
  units: number;
}
export interface PosterDecoration {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PosterPage {
  width: number;
  height: number;
  tiles: PosterTile[];
  decorations: PosterDecoration[];
}
export interface PosterDocument {
  pages: PosterPage[];
  total: number;
  bookCount: number;
}
export const POSTER_WIDTH = 1080;
const TOP = 252;
const GAP = 8;
function hash(seed: number, ...values: (string | number)[]) {
  let value = seed | 0;
  for (const part of values)
    for (const character of String(part)) {
      value = Math.imul(value ^ character.charCodeAt(0), 16777619);
      value ^= value >>> 13;
    }
  return (value >>> 0) / 4294967296;
}
export function posterSizeClasses(books: readonly PosterBook[]) {
  const positive = books.filter((b) => Number.isFinite(b.milliseconds) && b.milliseconds > 0);
  const minimum = Math.min(...positive.map((b) => b.milliseconds));
  const maximum = Math.max(...positive.map((b) => b.milliseconds));
  const limit = positive.length <= 6 ? 6 : positive.length <= 24 ? 4 : 2;
  return positive
    .map((book) => {
      const relative =
        maximum === minimum
          ? 0
          : (Math.log1p(book.milliseconds) - Math.log1p(minimum)) / (Math.log1p(maximum) - Math.log1p(minimum));
      const target =
        maximum === minimum
          ? positive.length === 1
            ? 6
            : positive.length <= 6
              ? 2
              : 1
          : 1 + (limit - 1) * Math.pow(relative, 1.15);
      const units = target >= 4.7 ? 6 : target >= 2.8 ? 4 : target >= 1.5 ? 2 : 1;
      return { book, units };
    })
    .sort(
      (a, b) => b.units - a.units || b.book.milliseconds - a.book.milliseconds || a.book.id.localeCompare(b.book.id),
    );
}
const shapes = (units: number): [number, number][] =>
  units === 6
    ? [
        [6, 4],
        [4, 6],
      ]
    : units === 4
      ? [[4, 4]]
      : units === 2
        ? [
            [2, 4],
            [4, 2],
          ]
        : [[2, 2]];
interface CellTile {
  x: number;
  y: number;
  w: number;
  h: number;
  book: PosterBook;
  units: number;
}
interface Block {
  items: CellTile[];
  grid: boolean[];
  decor: { x: number; y: number; w: number; h: number };
}
export function buildPoster(
  books: readonly PosterBook[],
  seed: number,
  output: PosterOutput,
  includeQuote = false,
): PosterDocument {
  if (output !== 'single') return buildLayout(books, seed, output, undefined, includeQuote);
  const classified = posterSizeClasses([...new Map(books.map((b) => [b.id, b])).values()]);
  const cells = classified.reduce((sum, b) => sum + b.units * 4, 8);
  let columns = Math.max(8, Math.ceil(Math.sqrt((cells * 952) / 1100) / 2) * 2);
  // Increase density until every book fits one normal 3:4 composition.
  for (;;) {
    const result = buildLayout(books, seed, output, columns, includeQuote);
    if (result.pages.length === 1) return result;
    columns += 2;
  }
}
function buildLayout(
  books: readonly PosterBook[],
  seed: number,
  output: PosterOutput,
  compactColumns?: number,
  includeQuote = false,
): PosterDocument {
  const unique = [...new Map(books.map((b) => [b.id, b])).values()];
  const classified = posterSizeClasses(unique);
  const cols = compactColumns ?? (classified.length <= 6 ? 8 : 10);
  const gap = compactColumns ? (classified.length > 80 ? 3 : classified.length > 24 ? 5 : 8) : GAP;
  const effectiveGap = compactColumns ? Math.min(gap, 952 / (cols * 5)) : gap;
  const cell = (952 - (cols - 1) * effectiveGap) / cols;
  const rows = compactColumns ? Math.max(6, Math.floor((1100 + effectiveGap) / (cell + effectiveGap) / 2) * 2) : 12;
  const blocks: Block[] = [];
  function next() {
    const w = includeQuote ? Math.max(4, Math.ceil((cols * 0.25) / 2) * 2) : 4;
    const h = includeQuote ? Math.max(2, Math.ceil((rows * 0.15) / 2) * 2) : 2;
    const decor = { x: hash(seed, blocks.length, 'decor') > 0.5 ? cols - w : 0, y: rows - h, w, h };
    const grid = Array<boolean>(cols * rows).fill(false);
    for (let y = decor.y; y < rows; y++) for (let x = decor.x; x < decor.x + decor.w; x++) grid[y * cols + x] = true;
    const block: Block = { items: [], grid, decor };
    blocks.push(block);
    return block;
  }
  function place(block: Block, item: (typeof classified)[number]): CellTile | undefined {
    const page = blocks.length - 1,
      tx = 0.46 + hash(seed, page, 'x') * 0.1,
      ty = 0.43 + hash(seed, page, 'y') * 0.12;
    let best: CellTile | undefined,
      score = Infinity;
    for (let y = 0; y < rows; y += 2)
      for (let x = 0; x < cols; x += 2)
        for (const [w, h] of shapes(item.units)) {
          if (x + w > cols || y + h > rows) continue;
          let free = true;
          for (let a = y; a < y + h && free; a++)
            for (let b = x; b < x + w; b++)
              if (block.grid[a * cols + b]) {
                free = false;
                break;
              }
          if (!free) continue;
          const distance = ((x + w / 2) / cols - tx) ** 2 + ((y + h / 2) / rows - ty) ** 2;
          const focus = item.units >= 4 ? distance * 15 : item.units === 2 ? distance * 4 : -distance * 3.2;
          const value =
            focus +
            hash(seed, page, item.book.id, x, y, w, h) * (item.units >= 4 ? 0.12 : item.units === 2 ? 0.28 : 0.66);
          if (value < score) {
            score = value;
            best = { x, y, w, h, ...item };
          }
        }
    if (best)
      for (let y = best.y; y < best.y + best.h; y++)
        for (let x = best.x; x < best.x + best.w; x++) block.grid[y * cols + x] = true;
    return best;
  }
  let block = next();
  for (const item of classified) {
    let tile = place(block, item);
    if (!tile) {
      block = next();
      tile = place(block, item);
    }
    if (!tile) throw Error('Poster layout failed');
    block.items.push(tile);
  }
  const gridHeight = rows * cell + (rows - 1) * effectiveGap,
    stride = gridHeight + 90;
  const perImage = output === 'long' ? Math.max(1, Math.floor((8192 - TOP - 110) / stride)) : 1;
  const pages: PosterPage[] = [];
  for (let index = 0; index < blocks.length; index += perImage) {
    const batch = blocks.slice(index, index + perImage),
      tiles: PosterTile[] = [],
      decorations: PosterDecoration[] = [];
    batch.forEach((part, i) => {
      const y = TOP + i * stride;
      part.items.forEach((t) =>
        tiles.push({
          book: t.book,
          units: t.units,
          x: 64 + t.x * (cell + effectiveGap),
          y: y + t.y * (cell + effectiveGap),
          width: t.w * cell + (t.w - 1) * effectiveGap,
          height: t.h * cell + (t.h - 1) * effectiveGap,
        }),
      );
      decorations.push({
        x: 64 + part.decor.x * (cell + effectiveGap),
        y: y + part.decor.y * (cell + effectiveGap),
        width: part.decor.w * cell + (part.decor.w - 1) * effectiveGap,
        height: part.decor.h * cell + (part.decor.h - 1) * effectiveGap,
      });
    });
    pages.push({
      width: POSTER_WIDTH,
      height: output === 'single' ? 1440 : Math.ceil(TOP + batch.length * stride + 20),
      tiles,
      decorations,
    });
  }
  return { pages, total: classified.reduce((sum, b) => sum + b.book.milliseconds, 0), bookCount: classified.length };
}
/** Conservatively wrap with explicit width units; never rely on platform-specific automatic SVG wrapping. */
export function wrapPosterText(value: string, maxUnits: number, maxLines: number) {
  const lines: string[] = [];
  let line = '',
    units = 0;
  for (const c of value.trim()) {
    const w = (c.codePointAt(0) ?? 0) > 255 ? 1 : 0.6;
    if (c === '\n' || units + w > maxUnits) {
      lines.push(line);
      line = '';
      units = 0;
    }
    if (c !== '\n') {
      line += c;
      units += w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] =
      Array.from(lines[maxLines - 1])
        .slice(0, -1)
        .join('') + '…';
  }
  return lines;
}
export function posterPreset(today: string, kind: 'year' | 'lastYear' | 'quarter' | 'lastMonth'): DateRange {
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7));
  if (kind === 'year') return { start: `${year}-01-01`, end: today };
  if (kind === 'lastYear') return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  if (kind === 'quarter')
    return { start: `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, end: today };
  return {
    start: new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
  };
}

export function posterInitialRange(start: string | undefined, end: string | undefined, today: string): DateRange {
  const valid = (v: string | undefined): v is string =>
    !!v &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    valid(start) &&
    valid(end) &&
    start <= end &&
    end <= today &&
    (Date.parse(end) - Date.parse(start)) / 86400000 < 36600
  )
    return { start, end };
  const date = new Date(today + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 29);
  return { start: date.toISOString().slice(0, 10), end: today };
}

export interface PosterLabels {
  title: string;
  quote: string;
  range: string;
  total: string;
  unknownAuthor: string;
  page: string;
}

/** Fit the personal note into the final reserved space, never on top of a cover. */
export function posterQuoteLayout(page: PosterPage, value: string) {
  const quote = value.replace(/\s+/gu, ' ').trim();
  const box = page.decorations.at(-1);
  if (!quote || !box) return undefined;
  const padding = Math.min(18, box.width * 0.07, box.height * 0.08);
  const width = box.width - padding * 2;
  const height = box.height - padding * 2;
  for (let size = 24; size >= 6; size -= 0.5) {
    const lines = wrapPosterText(quote, Math.max(1, width / (size * 1.05) - 1), 100);
    // Reserve a character so closing punctuation stays with the preceding line.
    for (let i = 1; i < lines.length; i++) {
      while (/^[，。！？、；：）》」』”’…,.!?;:）)\]}]/u.test(lines[i])) {
        lines[i - 1] += Array.from(lines[i])[0];
        lines[i] = Array.from(lines[i]).slice(1).join('');
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) if (!lines[i]) lines.splice(i, 1);
    const lineHeight = size * 1.5;
    const heading = size * 1.4;
    const fitsWidth = lines.every(
      (line) =>
        Array.from(line).reduce((sum, c) => sum + ((c.codePointAt(0) ?? 0) > 255 ? 1 : 0.6), 0) * size * 1.05 <= width,
    );
    if (fitsWidth && heading + lines.length * lineHeight <= height) {
      const top = box.y + padding + (height - heading - lines.length * lineHeight) / 2;
      return { box, x: box.x + padding, top, size, lineHeight, heading, lines };
    }
  }
  return undefined;
}
