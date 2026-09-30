import {
  createReaderTextSelectionFromSourceRange,
  resolveReaderTextSelectionSegmentSourceRange,
  type ReaderHitEntry,
  type ReaderRuntime,
  type ReaderSourcePoint,
  type ReaderSourceRange,
  type ReaderTextSelection,
  type ReaderRenderFrame,
  type ReaderSnapshot,
} from '../../../reader';
import type { ReaderOverlayRect } from '../../../reader/native';

import type { ReaderHighlight, ReaderHighlightColor } from '../domain/reader-highlight';

export function createReaderHighlightOverlayResolver(
  highlights: readonly ReaderHighlight[],
  colors: Readonly<Record<ReaderHighlightColor, string>>,
) {
  const chapters = new Map<string, ReaderHighlight[]>();
  for (const highlight of highlights) {
    const chapter = chapters.get(highlight.href) ?? [];
    chapter.push(highlight);
    chapters.set(highlight.href, chapter);
  }
  const cache = new WeakMap<ReaderRenderFrame, { key: string; overlays: readonly ReaderOverlayRect[] }>();
  return (snapshot: ReaderSnapshot, frame: ReaderRenderFrame): readonly ReaderOverlayRect[] => {
    const href = frame.manifestHref ?? snapshot.position?.locator?.manifestHref ?? '';
    const key = `${snapshot.revisionId}:${href}`;
    const cached = cache.get(frame);
    if (cached?.key === key) return cached.overlays;
    const overlays = createReaderHighlightOverlays(
      snapshot.revisionId,
      href,
      frame.hits ?? [],
      chapters.get(href) ?? [],
      colors,
    );
    cache.set(frame, { key, overlays });
    return overlays;
  };
}

export function createReaderHighlightRegions(
  entries: readonly ReaderHitEntry[],
  highlights: readonly ReaderHighlight[],
  href: string,
) {
  return highlights.flatMap((highlight) => {
    if (highlight.href !== href) return [];
    const selection = createReaderTextSelectionFromSourceRange(entries, highlight.sourceRange);
    return selection ? [{ highlight, selection }] : [];
  });
}

export function createReaderHighlightOverlays(
  revisionId: number,
  href: string,
  entries: readonly ReaderHitEntry[],
  highlights: readonly ReaderHighlight[],
  colors: Readonly<Record<ReaderHighlightColor, string>>,
): readonly ReaderOverlayRect[] {
  return createReaderHighlightRegions(entries, highlights, href).flatMap(({ highlight, selection }) =>
    selection.bounds.map((bounds) => ({
      revisionId,
      bounds,
      color: colors[highlight.color ?? 'yellow'],
      radius: 2,
      ...highlightDecoration(highlight),
    })),
  );
}

export async function resolveReaderSelectionSourceRange(
  runtime: ReaderRuntime,
  selection: ReaderTextSelection,
  href: string,
): Promise<ReaderSourceRange | undefined> {
  if (selection.sourceRange) return selection.sourceRange;
  if (selection.searchSegments.length === 0 || selection.searchSegments.length !== selection.geometryRequests.length)
    return undefined;

  const ranges: ReaderSourceRange[] = [];
  for (const segment of selection.searchSegments) {
    const response = await runtime.search({
      query: segment.text,
      caseSensitive: true,
      limit: 256,
    });
    const range = resolveReaderTextSelectionSegmentSourceRange(segment, response.results, href);
    if (!range || !rangeFollows(ranges.at(-1), range)) return undefined;
    ranges.push(range);
  }

  const first = ranges[0];
  const last = ranges.at(-1);
  return first && last ? { start: first.start, end: last.end } : undefined;
}

export async function resolveReaderHighlightOverlays(
  runtime: ReaderRuntime,
  revisionId: number,
  href: string,
  entries: readonly ReaderHitEntry[],
  highlights: readonly ReaderHighlight[],
  color: string | Readonly<Record<ReaderHighlightColor, string>>,
): Promise<readonly ReaderOverlayRect[]> {
  const pageIndexes = new Set(entries.map((entry) => entry.pageIndex));
  const overlays: ReaderOverlayRect[] = [];

  for (const highlight of highlights) {
    if (highlight.href !== href) continue;
    const localSelection = createReaderTextSelectionFromSourceRange(entries, highlight.sourceRange);
    const overlayColor = typeof color === 'string' ? color : color[highlight.color ?? 'yellow'];
    if (localSelection) {
      overlays.push(
        ...localSelection.bounds.map((bounds) => ({
          revisionId,
          bounds,
          color: overlayColor,
          radius: 2,
          ...highlightDecoration(highlight),
        })),
      );
      continue;
    }

    const exact = await runtime.resolveExactSourceRange({ href, sourceRange: highlight.sourceRange });
    if (exact.status === 'resolved') {
      overlays.push(
        ...exact.rects
          .filter((rect) => pageIndexes.has(rect.pageIndex))
          .map((rect) => ({
            revisionId,
            bounds: rect.bounds,
            color: overlayColor,
            radius: 2,
            ...highlightDecoration(highlight),
          })),
      );
    }
    // Pending and unavailable anchors remain unpainted until the engine can
    // validate their source text against the current layout.
  }

  return overlays;
}

function highlightDecoration(highlight: ReaderHighlight): Pick<ReaderOverlayRect, 'decoration' | 'thickness'> {
  return highlight.style === 'underline' || highlight.style === 'wavy'
    ? { decoration: highlight.style, thickness: 1.5 }
    : {};
}

function rangeFollows(previous: ReaderSourceRange | undefined, current: ReaderSourceRange): boolean {
  return !previous || compareSourcePoints(previous.end, current.start) <= 0;
}

function compareSourcePoints(left: ReaderSourcePoint, right: ReaderSourcePoint): number {
  const length = Math.min(left.nodePath.length, right.nodePath.length);
  for (let index = 0; index < length; index += 1) {
    if (left.nodePath[index] !== right.nodePath[index]) {
      return left.nodePath[index] - right.nodePath[index];
    }
  }
  return left.nodePath.length === right.nodePath.length
    ? left.textOffset - right.textOffset
    : left.nodePath.length - right.nodePath.length;
}
