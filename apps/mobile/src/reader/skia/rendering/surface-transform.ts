export interface ReaderSurfaceTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  toDisplayPoint(x: number, y: number): { readonly x: number; readonly y: number };
  toViewportPoint(x: number, y: number): { readonly x: number; readonly y: number };
}

export function createReaderSurfaceTransform(scale: number, offsetX: number, offsetY: number): ReaderSurfaceTransform {
  const safeScale = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return {
    scale: safeScale,
    offsetX,
    offsetY,
    toDisplayPoint: (x, y) => ({ x: (x - offsetX) / safeScale, y: (y - offsetY) / safeScale }),
    toViewportPoint: (x, y) => ({ x: x * safeScale + offsetX, y: y * safeScale + offsetY }),
  };
}
