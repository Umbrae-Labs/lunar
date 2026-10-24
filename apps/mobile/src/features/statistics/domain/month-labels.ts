/** Keep month starts anchored to their week; prefer newer labels when space is tight. */
export function layoutMonthLabels(
  candidates: { date: string; column: number; width: number }[],
  stride: number,
  gridWidth: number,
  gap = 8,
  viewport?: { left: number; width: number },
) {
  let rightBoundary = gridWidth + gap;
  return candidates
    .toReversed()
    .flatMap((label) => {
      const left = label.column * stride;
      // Never move a label onto another week's column or clip it at the right edge.
      if (label.width <= 0 || left + label.width + gap > rightBoundary) return [];
      rightBoundary = left;
      return [{ ...label, left }];
    })
    .toReversed()
    .filter(
      (label) =>
        !viewport || (label.left >= viewport.left && label.left + label.width <= viewport.left + viewport.width),
    );
}
export function heatmapDimensions(_cardWidth: number, fontScale: number) {
  const weekdayWidth = Math.max(32, Math.ceil(24 * fontScale));
  const cellSize = Math.max(14, Math.ceil(16 * fontScale));
  return { weekdayWidth, cellSize, rowHeight: cellSize };
}

/** Fade the whole label before either edge can clip a glyph. No time-based state. */
export function monthLabelOpacity(
  left: number,
  width: number,
  offset: number,
  viewportWidth: number,
  gridWidth: number,
) {
  'worklet';
  if (viewportWidth <= 0 || width <= 0) return 0;
  const end = Math.max(0, gridWidth - viewportWidth);
  const scroll = Math.max(0, Math.min(end, offset));
  const startDistance = left - scroll;
  const endDistance = scroll + viewportWidth - left - width;
  // A one-point invisible guard also covers subpixel rounding at the clipping edge.
  const progress = Math.max(0, Math.min(1, (Math.min(startDistance, endDistance) - 1) / 7));
  return progress * progress * (3 - 2 * progress);
}
