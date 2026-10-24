import type { PosterPage, PosterTile } from './poster';

export type PosterLayer = PosterTile & { lift: number; rotation: number };

/** Shared by raster output, editor hit testing, and live crop geometry. */
export function posterLayers(page: PosterPage): PosterLayer[] {
  const ordered = [...page.tiles].sort(
    (a, b) => b.book.milliseconds - a.book.milliseconds || a.book.id.localeCompare(b.book.id),
  );
  const equalTime =
    ordered.length > 1 && ordered.every((tile) => tile.book.milliseconds === ordered[0].book.milliseconds);
  const ranks = new Map(
    (equalTime ? [] : ordered.slice(0, 2)).map((tile, index) => [tile.book.id, index === 0 ? 1 : 0.6]),
  );
  return page.tiles
    .map((tile) => {
      const lift = ranks.get(tile.book.id) ?? 0;
      const growth = 1 + lift * 0.055;
      const width = tile.width * growth,
        height = tile.height * growth;
      return {
        ...tile,
        width,
        height,
        x: tile.x - (width - tile.width) / 2,
        y: tile.y - (height - tile.height) / 2 - lift * 7,
        lift,
        rotation: lift === 1 ? -1.6 : lift ? 1.2 : 0,
      };
    })
    .sort((a, b) => a.lift - b.lift);
}

export function posterLayerDelta(layer: PosterLayer, dx: number, dy: number) {
  'worklet';
  const angle = (-layer.rotation * Math.PI) / 180;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function posterLayerPoint(layer: PosterLayer, x: number, y: number) {
  'worklet';
  const point = posterLayerDelta(layer, x - layer.x - layer.width / 2, y - layer.y - layer.height / 2);
  return { x: point.x + layer.width / 2, y: point.y + layer.height / 2 };
}

export function posterLayerContains(layer: PosterLayer, x: number, y: number) {
  'worklet';
  const point = posterLayerPoint(layer, x, y);
  return point.x >= 0 && point.x < layer.width && point.y >= 0 && point.y < layer.height;
}

export function posterLayerAt(layers: readonly PosterLayer[], x: number, y: number) {
  'worklet';
  for (let i = layers.length - 1; i >= 0; i--) if (posterLayerContains(layers[i], x, y)) return layers[i];
  return undefined;
}
