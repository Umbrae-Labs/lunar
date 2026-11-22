export type PosterCamera = {
  x: number;
  y: number;
  scale: number;
};
export function fitPosterCamera(pw: number, ph: number, vw: number, vh: number): PosterCamera {
  'worklet';
  const scale = Math.min(Math.max(1, vw - 24) / pw, Math.max(1, vh - 24) / ph);
  return { x: (vw - pw * scale) / 2, y: (vh - ph * scale) / 2, scale };
}
export function clampPosterCamera(camera: PosterCamera, pw: number, ph: number, vw: number, vh: number): PosterCamera {
  'worklet';
  const fit = fitPosterCamera(pw, ph, vw, vh);
  const scale = Math.max(fit.scale, Math.min(Math.max(fit.scale * 8, (vw / pw) * 4), camera.scale));
  const w = pw * scale,
    h = ph * scale;
  return {
    scale,
    x: w <= vw - 24 ? (vw - w) / 2 : Math.max(vw - 12 - w, Math.min(12, camera.x)),
    y: h <= vh - 24 ? (vh - h) / 2 : Math.max(vh - 12 - h, Math.min(12, camera.y)),
  };
}
