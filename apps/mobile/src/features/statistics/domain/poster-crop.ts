export interface PosterCrop {
  x: number;
  y: number;
  zoom: number;
}
export const DEFAULT_POSTER_CROP: PosterCrop = { x: 0.5, y: 0.5, zoom: 1 };
export function clampCrop(value: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, value));
}
export function normalizePosterCrop(crop?: Partial<PosterCrop>): PosterCrop {
  'worklet';
  return {
    x: clampCrop(Number.isFinite(crop?.x) ? crop!.x! : 0.5, 0, 1),
    y: clampCrop(Number.isFinite(crop?.y) ? crop!.y! : 0.5, 0, 1),
    zoom: clampCrop(Number.isFinite(crop?.zoom) ? crop!.zoom! : 1, 1, 3),
  };
}
/** The same normalized crop drives the gesture preview and the exported source rect. */
export function posterCoverFrame(iw: number, ih: number, w: number, h: number, crop?: PosterCrop) {
  'worklet';
  const c = normalizePosterCrop(crop);
  const scale = Math.max(w / iw, h / ih) * c.zoom;
  const width = iw * scale,
    height = ih * scale;
  return { width, height, left: -(width - w) * c.x, top: -(height - h) * c.y, scale };
}
export function posterCoverSource(iw: number, ih: number, w: number, h: number, crop?: PosterCrop) {
  'worklet';
  const frame = posterCoverFrame(iw, ih, w, h, crop);
  return { x: -frame.left / frame.scale, y: -frame.top / frame.scale, width: w / frame.scale, height: h / frame.scale };
}
export function panPosterCrop(start: PosterCrop, dx: number, dy: number, iw: number, ih: number, w: number, h: number) {
  'worklet';
  const frame = posterCoverFrame(iw, ih, w, h, start);
  return normalizePosterCrop({
    zoom: start.zoom,
    x: frame.width - w > 0.001 ? start.x - dx / (frame.width - w) : start.x,
    y: frame.height - h > 0.001 ? start.y - dy / (frame.height - h) : start.y,
  });
}
export function zoomPosterCrop(
  start: PosterCrop,
  zoom: number,
  fx: number,
  fy: number,
  iw: number,
  ih: number,
  w: number,
  h: number,
  toX = fx,
  toY = fy,
) {
  'worklet';
  const old = posterCoverFrame(iw, ih, w, h, start);
  const next = posterCoverFrame(iw, ih, w, h, { ...start, zoom });
  const left = toX - ((fx - old.left) * next.scale) / old.scale;
  const top = toY - ((fy - old.top) * next.scale) / old.scale;
  return normalizePosterCrop({
    zoom,
    x: next.width - w > 0.001 ? -left / (next.width - w) : start.x,
    y: next.height - h > 0.001 ? -top / (next.height - h) : start.y,
  });
}
