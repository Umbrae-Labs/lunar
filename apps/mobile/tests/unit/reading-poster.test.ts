import { describe, expect, it } from 'vitest';
import {
  buildPoster,
  posterQuoteLayout,
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
      expect(buildPoster(books(120), seed, 'pages').pages.length).toBeLessThanOrEqual(6);
    }
  });
  for (const count of [1, 6, 20, 50, 120, 500])
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
