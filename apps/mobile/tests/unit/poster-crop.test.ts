import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POSTER_CROP,
  normalizePosterCrop,
  panPosterCrop,
  posterCoverFrame,
  posterCoverSource,
  zoomPosterCrop,
} from '../../src/features/statistics/domain/poster-crop';
import { buildPoster } from '../../src/features/statistics/domain/poster';

describe('poster cover crops', () => {
  it('keeps the original centered crop until the user edits it', () => {
    expect(posterCoverSource(400, 600, 200, 100)).toEqual({ x: 0, y: 200, width: 400, height: 200 });
  });
  it('clamps drag edges without exposing empty pixels, and permits reversing immediately', () => {
    const top = panPosterCrop(DEFAULT_POSTER_CROP, 10000, 10000, 400, 600, 200, 100);
    expect(top).toEqual({ x: 0.5, y: 0, zoom: 1 });
    const reversed = panPosterCrop(top, 0, -20, 400, 600, 200, 100);
    expect(reversed.y).toBeCloseTo(0.1);
    expect(posterCoverSource(400, 600, 200, 100, top).y).toBe(0);
  });
  it('anchors pinch zoom to the point under the fingers, including a moving focal point', () => {
    const start = DEFAULT_POSTER_CROP;
    const next = zoomPosterCrop(start, 2, 80, 40, 400, 600, 200, 100, 95, 45);
    const before = posterCoverFrame(400, 600, 200, 100, start);
    const after = posterCoverFrame(400, 600, 200, 100, next);
    expect((80 - before.left) / before.scale).toBeCloseTo((95 - after.left) / after.scale);
    expect((40 - before.top) / before.scale).toBeCloseTo((45 - after.top) / after.scale);
  });
  it('sanitizes non-finite inputs and limits zoom to 100–300%', () => {
    expect(normalizePosterCrop({ x: NaN, y: Infinity, zoom: NaN })).toEqual(DEFAULT_POSTER_CROP);
    expect(normalizePosterCrop({ x: -1, y: 2, zoom: 100 })).toEqual({ x: 0, y: 1, zoom: 3 });
    expect(zoomPosterCrop(DEFAULT_POSTER_CROP, 0.01, 100, 50, 400, 600, 200, 100).zoom).toBe(1);
  });
  it('exports exactly the viewport crop at different sizes and aspect ratios', () => {
    for (const [w, h] of [
      [240, 120],
      [120, 240],
      [200, 200],
    ]) {
      for (const x of [0, 0.5, 1])
        for (const y of [0, 0.5, 1])
          for (const zoom of [1, 1.7, 3]) {
            const crop = { x, y, zoom };
            const source = posterCoverSource(480, 720, w, h, crop);
            const exportSource = posterCoverSource(480, 720, w * 4, h * 4, crop);
            expect(exportSource).toEqual(source);
            expect(source.x).toBeGreaterThanOrEqual(0);
            expect(source.y).toBeGreaterThanOrEqual(0);
            expect(source.x + source.width).toBeLessThanOrEqual(480.0001);
            expect(source.y + source.height).toBeLessThanOrEqual(720.0001);
          }
    }
  });
  it('preserves book-specific crops across shuffling, selections and all output formats', () => {
    const books = Array.from({ length: 20 }, (_, n) => ({
      id: String(n),
      title: 'Book',
      author: '',
      coverUri: 'file://cover',
      milliseconds: (20 - n) * 60000,
      crop: { x: n / 20, y: 1 - n / 20, zoom: 1.5 },
    }));
    for (const output of ['single', 'long', 'pages'] as const)
      for (const seed of [1, 9]) {
        const document = buildPoster(
          books.filter((b) => b.id !== '3'),
          seed,
          output,
        );
        for (const tile of document.pages.flatMap((p) => p.tiles))
          expect(tile.book.crop).toEqual(books[Number(tile.book.id)].crop);
      }
  });
});
