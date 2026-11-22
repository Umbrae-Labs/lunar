/**
 * Where a scrolled reader's windows sit on its strip. Rito lays each chapter
 * out as one strip cut into windows a viewport long, every window its own
 * spread, so the strip is rebuilt around the visible window from the windows
 * on either side of it, each placed directly against its neighbor. Positions
 * are view units down the strip; only differences between them matter.
 */

/** One window placed on the strip. `length` is how far its content runs. */
export interface ReaderScrollPlacement {
  readonly key: string;
  readonly top: number;
  readonly length: number;
}

/** A window next to the visible one, `distance` windows away in `direction`. */
export interface ReaderScrollNeighbor {
  readonly key: string;
  readonly direction: 'next' | 'previous';
  readonly distance: number;
  readonly length: number;
}

/**
 * Places the visible window at `top` and its neighbors against it, ordered
 * down the strip. A neighbor is placed only when every window between it and
 * the visible one is known: a gap would leave it floating at a guessed place.
 */
export function placeScrollWindows(
  visible: { readonly key: string; readonly length: number },
  top: number,
  neighbors: readonly ReaderScrollNeighbor[],
): readonly ReaderScrollPlacement[] {
  const placements: ReaderScrollPlacement[] = [{ key: visible.key, top, length: visible.length }];
  const chain = (direction: 'next' | 'previous') =>
    neighbors
      .filter((neighbor) => neighbor.direction === direction)
      .sort((left, right) => left.distance - right.distance);
  let below = top + visible.length;
  let expected = 1;
  for (const neighbor of chain('next')) {
    if (neighbor.distance !== expected) break;
    placements.push({ key: neighbor.key, top: below, length: neighbor.length });
    below += neighbor.length;
    expected += 1;
  }
  let above = top;
  expected = 1;
  for (const neighbor of chain('previous')) {
    if (neighbor.distance !== expected) break;
    above -= neighbor.length;
    placements.unshift({ key: neighbor.key, top: above, length: neighbor.length });
    expected += 1;
  }
  return placements;
}

/**
 * Extends freshly placed windows with earlier ones that continue them, up to
 * `depth` windows either side of the visible one. A peek can come back short
 * on one side while navigation is queued; the windows already shown there
 * still sit where they were placed, so they stay rather than leave a gap the
 * view has to scroll over blank.
 */
export function mergeScrollWindows<T extends ReaderScrollPlacement>(
  fresh: readonly T[],
  earlier: readonly T[],
  visibleKey: string,
  depth: number,
): T[] {
  const windows = [...fresh];
  const visibleIndex = windows.findIndex((window) => window.key === visibleKey);
  if (visibleIndex < 0) return windows;
  const touches = (left: number, right: number) => Math.abs(left - right) < 0.5;
  let below = windows.length - 1 - visibleIndex;
  while (below < depth) {
    const last = windows[windows.length - 1]!;
    const next = earlier.find((window) => touches(window.top, last.top + last.length));
    if (!next) break;
    windows.push(next);
    below += 1;
  }
  let above = visibleIndex;
  while (above < depth) {
    const first = windows[0]!;
    const previous = earlier.find((window) => touches(window.top + window.length, first.top));
    if (!previous) break;
    windows.unshift(previous);
    above += 1;
  }
  return windows;
}

/** The window at strip position `position`, by index into `placements`. */
export function scrollWindowAt(placements: readonly ReaderScrollPlacement[], position: number): number | undefined {
  'worklet';
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index]!;
    if (position >= placement.top && position < placement.top + placement.length) return index;
  }
  return undefined;
}

/**
 * How far the strip may scroll: from the first placed window's top to where
 * the last placed window's end reaches the view's bottom. The current offset
 * always stays reachable, so a jump past the placed windows is never undone
 * by the bounds that arrive with them.
 */
export function scrollBounds(
  placements: readonly ReaderScrollPlacement[],
  viewportHeight: number,
  offset: number,
): { readonly min: number; readonly max: number } {
  if (placements.length === 0) return { min: offset, max: offset };
  const first = placements[0]!;
  const last = placements[placements.length - 1]!;
  const min = Math.min(first.top, offset);
  const max = Math.max(last.top + last.length - viewportHeight, min, offset);
  return { min, max };
}

/**
 * The offset that shows a window jumped to: its target line at the top of the
 * content box (`marginTop` below the view's top), or the window from its top
 * when the navigation named no line.
 */
export function scrollJumpOffset(
  top: number,
  scale: number,
  marginTop: number,
  targetOffset: number | undefined,
): number {
  return targetOffset === undefined ? top : top + (targetOffset - marginTop) * scale;
}
