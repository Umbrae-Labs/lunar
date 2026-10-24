import { expect, it } from 'vitest';
import { buildPoster } from '../../src/features/statistics/domain/poster';
import {
  posterLayers,
  posterLayerAt,
  posterLayerPoint,
  posterLayerDelta,
} from '../../src/features/statistics/domain/poster-depth';

const books = Array.from({ length: 120 }, (_, i) => ({
  id: String(i),
  title: `Book ${i}`,
  author: 'Author',
  coverUri: null,
  milliseconds: 60000 * (121 - i),
}));
it('keeps every book and places only the two focal covers in the foreground', () => {
  for (const count of [6, 20, 60, 120]) {
    const page = buildPoster(books.slice(0, count), 1, 'single').pages[0];
    const layers = posterLayers(page);
    expect(new Set(layers.map((tile) => tile.book.id)).size).toBe(count);
    expect(layers.filter((tile) => tile.lift > 0)).toHaveLength(2);
    expect(layers.at(-1)!.book.id).toBe('0');
    for (const tile of layers) expect(tile.book).toBe(page.tiles.find((item) => item.book.id === tile.book.id)!.book);
  }
});
it('maps rotated screen positions and drag vectors back into the same crop coordinates', () => {
  for (const layer of posterLayers(buildPoster(books.slice(0, 6), 1, 'single').pages[0])) {
    const a = (layer.rotation * Math.PI) / 180;
    for (const [x, y] of [
      [12, 15],
      [layer.width / 2, layer.height / 2],
      [layer.width - 2, layer.height - 3],
    ]) {
      const dx = x - layer.width / 2,
        dy = y - layer.height / 2;
      const px = layer.x + layer.width / 2 + dx * Math.cos(a) - dy * Math.sin(a);
      const py = layer.y + layer.height / 2 + dx * Math.sin(a) + dy * Math.cos(a);
      const local = posterLayerPoint(layer, px, py);
      expect(local.x).toBeCloseTo(x);
      expect(local.y).toBeCloseTo(y);
    }
    const delta = posterLayerDelta(layer, 10 * Math.cos(a) - 4 * Math.sin(a), 10 * Math.sin(a) + 4 * Math.cos(a));
    expect(delta.x).toBeCloseTo(10);
    expect(delta.y).toBeCloseTo(4);
  }
});
it('does not invent foreground rankings when every reading duration is equal', () => {
  const page = buildPoster(
    books.slice(0, 6).map((book) => ({ ...book, milliseconds: 60000 })),
    1,
    'single',
  ).pages[0];
  expect(posterLayers(page).every((tile) => tile.lift === 0 && tile.rotation === 0)).toBe(true);
});
it('selects the foreground book in an overlapping area instead of the obscured background', () => {
  const layers = posterLayers(buildPoster(books, 1, 'single').pages[0]);
  const front = layers.at(-1)!;
  expect(posterLayerAt(layers, front.x + front.width / 2, front.y + front.height / 2)?.book.id).toBe(front.book.id);
  expect(posterLayerAt(layers, -20, -20)).toBeUndefined();
  const behind = { ...front, book: { ...front.book, id: 'behind' }, lift: 0, rotation: 0 };
  expect(posterLayerAt([behind, front], front.x + front.width / 2, front.y + front.height / 2)).toBe(front);
});
