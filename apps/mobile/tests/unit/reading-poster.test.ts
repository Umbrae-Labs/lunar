import { describe, expect, it } from 'vitest';
import {
  buildPoster,
  posterQuoteLayout,
  posterSizeClasses,
  posterBookTitle,
  posterInitialRange,
  posterPreset,
  wrapPosterText,
  type PosterBook,
} from '../../src/features/statistics/domain/poster';

const books = (count: number): PosterBook[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: `书籍 ${i}`,
    author: '作者',
    coverUri: null,
    milliseconds: Math.round(60000 * (1 + 300 / (i + 1))),
  }));
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width - 0.01 &&
  a.x + a.width > b.x + 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  a.y + a.height > b.y + 0.01;

describe('reading poster output contract', () => {
  it('does not waste pages on narrow, unusable gaps', () => {
    for (const seed of [1, 2, 13, 42]) {
      expect(buildPoster(books(20), seed, 'pages').pages.length).toBeLessThanOrEqual(2);
      const source = books(120);
      const requiredCells = posterSizeClasses(source).reduce((sum, book) => sum + book.units * 4, 0);
      // Each page has 10 × 12 cells, with eight reserved for breathing room.
      const minimumPages = Math.ceil(requiredCells / (120 - 8));
      expect(buildPoster(source, seed, 'pages').pages.length).toBeLessThanOrEqual(minimumPages + 1);
    }
  });
  for (const count of [1, 6, 20, 50, 60, 120, 500])
    for (const output of ['single', 'pages', 'long'] as const) {
      it(`${count} books / ${output}: complete, bounded, non-overlapping`, () => {
        const source = books(count);
        const result = buildPoster(source, 13, output);
        if (output === 'single') {
          expect(result.pages).toHaveLength(1);
          expect(result.pages[0]).toMatchObject({ width: 1080, height: 1440 });
        }
        const tiles = result.pages.flatMap((p) => p.tiles);
        expect(tiles).toHaveLength(count);
        expect(new Set(tiles.map((t) => t.book.id)).size).toBe(count);
        expect(result.total).toBe(source.reduce((n, b) => n + b.milliseconds, 0));
        for (const page of result.pages) {
          expect(page.height).toBeLessThanOrEqual(8192);
          for (const tile of page.tiles) {
            expect(tile.width).toBeGreaterThanOrEqual(output === 'single' ? 24 : 184);
            expect(tile.height).toBeGreaterThanOrEqual(output === 'single' ? 24 : 184);
            expect(tile.x).toBeGreaterThanOrEqual(64);
            expect(tile.x + tile.width).toBeLessThanOrEqual(page.width - 63);
            expect(tile.y + tile.height).toBeLessThan(page.height - 20);
            for (const other of [...page.tiles.filter((t) => t !== tile), ...page.decorations])
              expect(overlaps(tile, other)).toBe(false);
          }
        }
      });
    }
  it('deduplicates and rejects invalid durations without inflating summary', () => {
    const source = books(3);
    const result = buildPoster(
      [
        ...source,
        source[0],
        { ...source[1], id: 'zero', milliseconds: 0 },
        { ...source[2], id: 'nan', milliseconds: NaN },
      ],
      1,
      'pages',
    );
    expect(result.bookCount).toBe(3);
    expect(result.total).toBe(source.reduce((n, b) => n + b.milliseconds, 0));
  });
  it('reproduces a layout and changes composition without changing book weights', () => {
    const source = books(50);
    const a = buildPoster(source, 1, 'pages');
    expect(buildPoster(source, 1, 'pages')).toEqual(a);
    const b = buildPoster(source, 2, 'long');
    expect(b.pages[0].tiles).not.toEqual(a.pages[0].tiles);
    const weights = (doc: typeof a) =>
      Object.fromEntries(doc.pages.flatMap((p) => p.tiles.map((t) => [t.book.id, t.units])));
    expect(weights(a)).toEqual(weights(b));
  });
  it('handles natural periods across year and leap boundaries', () => {
    expect(posterPreset('2024-03-15', 'lastMonth')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(posterPreset('2026-01-03', 'lastMonth')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(posterPreset('2026-10-17', 'quarter')).toEqual({ start: '2026-10-01', end: '2026-10-17' });
    expect(posterPreset('2026-10-17', 'lastYear')).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });
  it('validates deep-link dates instead of selecting another day or an unbounded range', () => {
    const fallback = { start: '2026-09-18', end: '2026-10-17' };
    for (const [start, end] of [
      ['2026-02-30', '2026-03-01'],
      ['2026-10-18', '2026-10-19'],
      ['2026-10-10', '2026-10-01'],
      ['0001-01-01', '2026-10-17'],
    ])
      expect(posterInitialRange(start, end, '2026-10-17')).toEqual(fallback);
    expect(posterInitialRange('2024-02-29', '2026-10-17', '2026-10-17')).toEqual({
      start: '2024-02-29',
      end: '2026-10-17',
    });
  });
  it('wraps long CJK titles and handles empty quotes', () => {
    expect(wrapPosterText('一二三四五六七八九十', 4, 2)).toEqual(['一二三四', '五六七…']);
    expect(wrapPosterText('', 20, 1)).toEqual([]);
  });
});

describe('personal note in cover whitespace', () => {
  for (const count of [6, 20, 50, 120, 500]) {
    it(`preserves all ${count} books and the full 40-character note`, () => {
      const page = buildPoster(books(count), 13, 'single', true).pages[0];
      expect(page.tiles).toHaveLength(count);
      const quote = '把日子读慢一点把时间留给喜欢的书'.repeat(3).slice(0, 40);
      const note = posterQuoteLayout(page, quote)!;
      expect(note.lines.join('')).toBe(quote);
      expect(note.top + note.heading + note.lines.length * note.lineHeight).toBeLessThanOrEqual(
        note.box.y + note.box.height,
      );
      for (const tile of page.tiles) expect(overlaps(tile, note.box)).toBe(false);
      expect(posterQuoteLayout(page, '  ')).toBeUndefined();
    });
  }
});

it('keeps closing punctuation attached, including consecutive marks', () => {
  for (const count of [6, 120, 500]) {
    const page = buildPoster(books(count), 13, 'single', true).pages[0];
    for (const quote of [
      '翻过的页，慢慢成为风景。',
      '读过这些书，然后呢？！继续读下去……',
      '把时间留给书页，把故事留在心里。',
    ]) {
      const note = posterQuoteLayout(page, quote)!;
      expect(note.lines.join('')).toBe(quote);
      for (const line of note.lines) expect(line).not.toMatch(/^[，。！？、；：）》」』”’…,.!?;:]/u);
    }
  }
});

describe('centre-first cover composition', () => {
  it('normalizes sparse inputs, keeps ties equal, and can reshuffle without losing crops', () => {
    const source = books(6).map((book) => ({ ...book, crop: { x: 0.2, y: 0.7, zoom: 1.5 } }));
    const clean = buildPoster(source, 1, 'single', true);
    expect(
      buildPoster([...source, source[0], { ...source[0], id: 'empty', milliseconds: 0 }], 1, 'single', true),
    ).toEqual(clean);
    const shuffled = buildPoster(source, 2, 'single', true);
    expect(shuffled.pages[0].tiles).not.toEqual(clean.pages[0].tiles);
    for (const tile of shuffled.pages[0].tiles) expect(tile.book.crop).toEqual(source[0].crop);
    const tied = buildPoster(
      source.map((book) => ({ ...book, milliseconds: 60000 })),
      1,
      'single',
    );
    const areas = tied.pages[0].tiles.map((tile) => Math.round(tile.width * tile.height));
    expect(new Set(areas).size).toBe(1);
  });
  it('balances the whole composition and keeps the centred note below all covers', () => {
    for (const count of [6, 20, 60, 120]) {
      const page = buildPoster(books(count), 1, 'single', true).pages[0];
      const area = page.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
      const cx = page.tiles.reduce((sum, tile) => sum + (tile.x + tile.width / 2) * tile.width * tile.height, 0) / area;
      expect(Math.abs(cx - page.width / 2)).toBeLessThan(50);
      const note = page.decorations[0];
      expect(note.align).toBe('center');
      for (const tile of page.tiles) expect(tile.y + tile.height).toBeLessThan(note.y);
    }
  });
  it('assigns each cover to a separate lighting block on long and paged exports', () => {
    for (const output of ['single', 'pages', 'long'] as const) {
      for (const page of buildPoster(books(120), 1, output, true).pages) {
        for (const tile of page.tiles) {
          const blocks = page.lighting.filter((region) => tile.y >= region.y && tile.y < region.y + region.height);
          expect(blocks).toHaveLength(1);
          expect(tile.y + tile.height).toBeLessThanOrEqual(blocks[0].y + blocks[0].height + 0.01);
        }
      }
    }
  });
  it('preserves a visible podium at high density, without inventing ranks for ties', () => {
    const weights = posterSizeClasses(books(120));
    expect(weights.slice(0, 3).map((b) => b.units)).toEqual([12, 9, 6]);
    expect(weights[0].units).toBeGreaterThanOrEqual(weights.at(-1)!.units * 6);
    expect(
      new Set(posterSizeClasses(books(120).map((b) => ({ ...b, milliseconds: 60000 }))).map((b) => b.units)).size,
    ).toBe(1);
  });
  it('fills the middle before sending smaller covers to the outside', () => {
    for (const count of [6, 20, 50, 60, 120, 500])
      for (const seed of [1, 2, 13]) {
        const page = buildPoster(books(count), seed, 'single', true).pages[0];
        // Sample the central area with tolerance for the intentional narrow gutters.
        let occupied = 0;
        for (let y = 650; y <= 850; y += 20)
          for (let x = 440; x <= 640; x += 20) {
            if (
              page.tiles.some(
                (tile) =>
                  x >= tile.x - 4 && x <= tile.x + tile.width + 4 && y >= tile.y - 4 && y <= tile.y + tile.height + 4,
              )
            )
              occupied++;
          }
        expect(occupied / 121).toBeGreaterThan(0.95);
      }
  });
});

describe('long light-novel captions', () => {
  const measure = (text: string, size: number) =>
    Array.from(text).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.6) * size, 0);
  const title = '末日时在做什么？有没有空？可以来拯救吗？';
  it('shows a full sentence title in a focal cover, without punctuation at line starts', () => {
    const result = posterBookTitle(title, 220, 145, 32, true, measure);
    expect(result.truncated).toBe(false);
    expect(result.lines.join('')).toBe(title);
    expect(result.lines.length).toBeLessThanOrEqual(3);
    for (const line of result.lines) {
      expect(measure(line, result.size)).toBeLessThanOrEqual(220);
      expect(line).not.toMatch(/^[，。！？）》」』]/u);
    }
  });
  it('keeps tiny cover captions legible and honestly ellipsizes instead of overflowing', () => {
    const result = posterBookTitle(title.repeat(3), 50, 28, 8, false, measure);
    expect(result.size).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.lines.at(-1)).toMatch(/…$/u);
    for (const line of result.lines) expect(measure(line, result.size)).toBeLessThanOrEqual(50);
  });
  it('keeps opening brackets with their text and fits wide Latin glyph measurements', () => {
    for (const title of [
      '我读过《某个很长的故事》，然后开始了新的旅程。',
      'WWWWW IIIII A Very Long Light Novel Name',
    ]) {
      const result = posterBookTitle(title, 160, 105, 22, true, (text, size) =>
        Array.from(text).reduce((sum, c) => sum + (c === 'W' ? 1.2 : 1) * size, 0),
      );
      for (const line of result.lines) expect(line).not.toMatch(/[《（「]$/u);
      expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(105);
    }
  });
});
