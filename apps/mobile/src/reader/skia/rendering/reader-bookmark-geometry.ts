import type { ReaderRenderFrame } from '../../contracts';

export const ReaderBookmarkWidth = 32;

export function readerBookmarkPullPhase(distance: number, threshold: number): 'idle' | 'pulling' | 'ready' {
  'worklet';
  return distance <= 0 ? 'idle' : distance < threshold ? 'pulling' : 'ready';
}

export function readerBookmarkPullHeight(baselineHeight: number, distance: number): number {
  'worklet';
  return Math.max(baselineHeight, distance);
}

export function readerBookmarkPlacement(
  frame: ReaderRenderFrame,
  pageScale: number,
  offsetX: number,
  offsetY: number,
  topInset: number,
) {
  const scale = Math.max(0.001, pageScale);
  const firstLineTop = frame.hits?.reduce(
    (top, entry) => Math.min(top, entry.bounds.y * scale + offsetY),
    Number.POSITIVE_INFINITY,
  );
  const height =
    firstLineTop !== undefined && Number.isFinite(firstLineTop)
      ? Math.max(topInset + 48, firstLineTop - 8)
      : topInset + 80;
  const x = offsetX + frame.width * scale - ReaderBookmarkWidth;
  return {
    x,
    height,
    pageX: (x - offsetX) / scale,
    pageY: -offsetY / scale,
    pageScaleX: 1 / scale,
    pageScaleY: height / (100 * scale),
  };
}
