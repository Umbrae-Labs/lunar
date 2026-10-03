import type {
  ReaderHitEntry,
  ReaderRect,
  ReaderSearchResult,
  ReaderSourcePoint,
  ReaderSourceRange,
  ReaderTextPosition,
  ReaderTextRangeGeometryRequest,
} from '../contracts';

export interface ReaderTextSelectionEndpoint {
  readonly entryIndex: number;
  readonly charIndex: number;
}

export interface ReaderTextSelectionSearchSegment {
  readonly text: string;
  readonly request: ReaderTextRangeGeometryRequest;
}

export interface ReaderTextSelectionRange {
  readonly start: ReaderTextSelectionEndpoint;
  readonly end: ReaderTextSelectionEndpoint;
}

type ReaderTextSelectionOrigin = ReaderTextSelectionRange;

interface ReaderTextSelectionPortion {
  readonly entry: ReaderHitEntry;
  readonly startCharIndex: number;
  readonly endCharIndex: number;
}

export interface ReaderTextSelection {
  readonly anchorIndex: number;
  readonly focusIndex: number;
  readonly entries: readonly ReaderHitEntry[];
  readonly bounds: readonly ReaderRect[];
  readonly text: string;
  readonly geometryRequests: readonly ReaderTextRangeGeometryRequest[];
  readonly searchSegments: readonly ReaderTextSelectionSearchSegment[];
  readonly origin: ReaderTextSelectionOrigin;
  readonly range: ReaderTextSelectionOrigin;
  readonly sourceRange?: ReaderSourceRange;
}

export function createReaderTextSelectionSearchQuery(selection: ReaderTextSelection): string {
  return selection.text;
}

/**
 * Rito's page-text index inserts one newline between every text-bearing line.
 * Selection display text can retain a wider paragraph gap, so collapse that
 * presentation-only gap before querying the index for a durable source range.
 */
export function normalizeReaderTextSelectionSearchQuery(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/\n{2,}/gu, '\n');
}

export function resolveReaderTextSelectionSegmentSourceRange(
  segment: ReaderTextSelectionSearchSegment,
  results: readonly ReaderSearchResult[],
  href: string,
): ReaderSourceRange | undefined {
  return findClosestSourceResult(results, segment.request, href)?.locator?.sourceRange;
}

export function resolveReaderTextSelectionSourceRange(
  selection: ReaderTextSelection,
  results: readonly ReaderSearchResult[],
  href: string,
): ReaderSourceRange | undefined {
  if (selection.sourceRange) return selection.sourceRange;
  if (selection.geometryRequests.length !== 1) return undefined;
  const request = selection.geometryRequests[0];
  return findClosestSourceResult(results, request, href)?.locator?.sourceRange;
}

function findClosestSourceResult(
  results: readonly ReaderSearchResult[],
  request: ReaderTextRangeGeometryRequest,
  href: string,
): ReaderSearchResult | undefined {
  const pageCandidates = results.filter(
    (result) => result.pageIndex === request.pageIndex && result.locator?.sourceRange,
  );
  const chapterCandidates = pageCandidates.filter((result) => result.locator?.manifestHref === href);
  const candidates = chapterCandidates.length > 0 ? chapterCandidates : pageCandidates;
  return candidates.reduce<ReaderSearchResult | undefined>(
    (closest, candidate) =>
      !closest || compareTextPositionDistance(candidate, closest, request) < 0 ? candidate : closest,
    undefined,
  );
}

export function findReaderHitIndex(entries: readonly ReaderHitEntry[], x: number, y: number): number | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (contains(entries[index].bounds, x, y)) return index;
  }
  return undefined;
}

export function findSelectableReaderHitIndex(
  entries: readonly ReaderHitEntry[],
  x: number,
  y: number,
  maximumDistance = 48,
): number | undefined {
  const exact = findReaderHitIndex(entries, x, y);
  if (exact !== undefined && isSelectable(entries[exact])) return exact;

  let selected: number | undefined;
  let selectedDistance = maximumDistance * maximumDistance;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isSelectable(entry)) continue;
    const distance = squaredDistanceToRect(entry.bounds, x, y);
    if (distance <= selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  }
  return selected;
}

export function createReaderTextSelection(
  entries: readonly ReaderHitEntry[],
  anchorIndex: number,
  focusIndex: number,
): ReaderTextSelection | undefined {
  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  const startEntry = entries[startIndex];
  const endEntry = entries[endIndex];
  if (!startEntry || !endEntry) return undefined;
  return createSelection(
    entries,
    {
      start: { entryIndex: startIndex, charIndex: 0 },
      end: { entryIndex: endIndex, charIndex: endEntry.text.length },
    },
    { entryIndex: focusIndex, charIndex: entries[focusIndex]?.text.length ?? 0 },
  );
}

export function createReaderWordSelectionAtPoint(
  entries: readonly ReaderHitEntry[],
  x: number,
  y: number,
  maximumDistance = 12,
): ReaderTextSelection | undefined {
  const entryIndex = findSelectableReaderHitIndex(entries, x, y, maximumDistance);
  if (entryIndex === undefined) return undefined;
  const entry = entries[entryIndex];
  const charIndex = charIndexAtPoint(entry, x, y);
  const word = wordRangeAt(entry.text, charIndex);
  return createSelection(
    entries,
    {
      start: { entryIndex, charIndex: word.start },
      end: { entryIndex, charIndex: word.end },
    },
    { entryIndex, charIndex: word.end },
  );
}

export function updateReaderTextSelectionAtPoint(
  entries: readonly ReaderHitEntry[],
  selection: ReaderTextSelection,
  x: number,
  y: number,
  maximumDistance = 48,
): ReaderTextSelection | undefined {
  const entryIndex = findSelectableReaderHitIndex(entries, x, y, maximumDistance);
  if (entryIndex === undefined) return selection;
  const focus = {
    entryIndex,
    charIndex: charIndexAtPoint(entries[entryIndex], x, y),
  };
  const beforeOrigin = compareEndpoints(focus, selection.origin.start) < 0;
  const start = beforeOrigin ? focus : selection.origin.start;
  const end = beforeOrigin ? selection.origin.end : maxEndpoint(selection.origin.end, focus);
  if (compareEndpoints(start, selection.range.start) === 0 && compareEndpoints(end, selection.range.end) === 0)
    return selection;
  return createSelection(entries, selection.origin, focus, beforeOrigin);
}

export function updateReaderTextSelectionBoundaryAtPoint(
  entries: readonly ReaderHitEntry[],
  selection: ReaderTextSelection,
  boundary: 'start' | 'end',
  x: number,
  y: number,
  maximumDistance = 72,
): ReaderTextSelection | undefined {
  const entryIndex = findSelectableReaderHitIndex(entries, x, y, maximumDistance);
  if (entryIndex === undefined) return selection;
  const endpoint = {
    entryIndex,
    charIndex: charIndexAtPoint(entries[entryIndex], x, y),
  };
  const previous = selection.range[boundary];
  if (endpoint.entryIndex === previous.entryIndex && endpoint.charIndex === previous.charIndex) return selection;
  const start = boundary === 'start' ? endpoint : selection.range.start;
  const end = boundary === 'end' ? endpoint : selection.range.end;
  if (compareEndpoints(start, end) >= 0) return selection;
  const normalized = {
    start: minEndpoint(start, end),
    end: maxEndpoint(start, end),
  };
  return createSelection(entries, normalized, normalized.end);
}

export function createReaderTextSelectionFromSourceRange(
  entries: readonly ReaderHitEntry[],
  sourceRange: ReaderSourceRange,
): ReaderTextSelection | undefined {
  let start: ReaderTextSelectionEndpoint | undefined;
  let end: ReaderTextSelectionEndpoint | undefined;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    const entryStart = entry.sourcePoint;
    if (!entryStart || !isSelectable(entry)) continue;
    const entryEnd = addSourceTextOffset(entryStart, entry.text.length);
    if (compareSourcePoints(entryEnd, sourceRange.start) <= 0) continue;
    if (compareSourcePoints(entryStart, sourceRange.end) >= 0) break;
    const startCharIndex = sameSourceNode(entryStart, sourceRange.start)
      ? Math.max(0, sourceRange.start.textOffset - entryStart.textOffset)
      : 0;
    const endCharIndex = sameSourceNode(entryStart, sourceRange.end)
      ? Math.min(entry.text.length, sourceRange.end.textOffset - entryStart.textOffset)
      : entry.text.length;
    start ??= { entryIndex, charIndex: startCharIndex };
    end = { entryIndex, charIndex: endCharIndex };
  }
  if (!start || !end) return undefined;
  const range = { start, end };
  return createSelection(entries, range, range.end);
}

export function createReaderTextSelectionFromRange(
  entries: readonly ReaderHitEntry[],
  range: ReaderTextSelectionRange,
): ReaderTextSelection | undefined {
  const start = entries[range.start.entryIndex];
  const end = entries[range.end.entryIndex];
  if (
    !start ||
    !end ||
    !isSelectable(start) ||
    !isSelectable(end) ||
    !Number.isInteger(range.start.charIndex) ||
    !Number.isInteger(range.end.charIndex) ||
    range.start.charIndex < 0 ||
    range.start.charIndex > start.text.length ||
    range.end.charIndex < 0 ||
    range.end.charIndex > end.text.length ||
    compareEndpoints(range.start, range.end) >= 0
  )
    return undefined;
  return createSelection(entries, range, range.end);
}

function createSelection(
  entries: readonly ReaderHitEntry[],
  origin: ReaderTextSelectionOrigin,
  focus: ReaderTextSelectionEndpoint,
  focusBeforeOrigin = false,
): ReaderTextSelection | undefined {
  const first = focusBeforeOrigin ? focus : origin.start;
  const last = focusBeforeOrigin ? origin.end : maxEndpoint(origin.end, focus);
  const range = {
    start: minEndpoint(first, last),
    end: maxEndpoint(first, last),
  };
  const portions = selectionPortions(entries, range.start, range.end);
  if (portions.length === 0) return undefined;
  const searchSegments = createSearchSegments(portions);
  return {
    anchorIndex: origin.start.entryIndex,
    focusIndex: focus.entryIndex,
    entries: portions.map((portion) => portion.entry),
    bounds: portions.map(portionBounds),
    text: joinSelectionText(portions),
    geometryRequests: createGeometryRequests(portions),
    searchSegments,
    origin,
    range,
    sourceRange: createSourceRange(portions),
  };
}

function createSourceRange(portions: readonly ReaderTextSelectionPortion[]): ReaderSourceRange | undefined {
  if (portions.some((portion) => !portion.entry.sourcePoint)) return undefined;
  const first = portions[0];
  const last = portions.at(-1);
  if (!first?.entry.sourcePoint || !last?.entry.sourcePoint) return undefined;
  return {
    start: addSourceTextOffset(first.entry.sourcePoint, first.startCharIndex),
    end: addSourceTextOffset(last.entry.sourcePoint, last.endCharIndex),
  };
}

function createSearchSegments(portions: readonly ReaderTextSelectionPortion[]): ReaderTextSelectionSearchSegment[] {
  const segments: ReaderTextSelectionSearchSegment[] = [];
  let pageStart = 0;
  while (pageStart < portions.length) {
    const pageIndex = portions[pageStart].entry.pageIndex;
    let pageEnd = pageStart;
    while (pageEnd + 1 < portions.length && portions[pageEnd + 1].entry.pageIndex === pageIndex) {
      pageEnd += 1;
    }
    const pagePortions = portions.slice(pageStart, pageEnd + 1);
    const first = pagePortions[0];
    const last = pagePortions.at(-1);
    if (first?.entry.textRange && last?.entry.textRange) {
      segments.push({
        text: joinSelectionText(pagePortions),
        request: {
          pageIndex,
          start: withCharIndex(first.entry.textRange.start, first.startCharIndex),
          end: withCharIndex(last.entry.textRange.end, last.endCharIndex),
        },
      });
    }
    pageStart = pageEnd + 1;
  }
  return segments;
}

function addSourceTextOffset(point: ReaderSourcePoint, offset: number): ReaderSourcePoint {
  return { nodePath: point.nodePath, textOffset: point.textOffset + offset };
}

function sameSourceNode(left: ReaderSourcePoint, right: ReaderSourcePoint): boolean {
  return (
    left.nodePath.length === right.nodePath.length &&
    left.nodePath.every((part, index) => part === right.nodePath[index])
  );
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

function selectionPortions(
  entries: readonly ReaderHitEntry[],
  first: ReaderTextSelectionEndpoint,
  last: ReaderTextSelectionEndpoint,
): ReaderTextSelectionPortion[] {
  const start = minEndpoint(first, last);
  const end = maxEndpoint(first, last);
  const portions: ReaderTextSelectionPortion[] = [];
  for (let index = start.entryIndex; index <= end.entryIndex; index += 1) {
    const entry = entries[index];
    if (!entry || !isSelectable(entry)) continue;
    const startCharIndex = index === start.entryIndex ? start.charIndex : 0;
    const endCharIndex = index === end.entryIndex ? end.charIndex : entry.text.length;
    if (endCharIndex <= startCharIndex) continue;
    portions.push({ entry, startCharIndex, endCharIndex });
  }
  return portions;
}

function createGeometryRequests(portions: readonly ReaderTextSelectionPortion[]): ReaderTextRangeGeometryRequest[] {
  const requests: ReaderTextRangeGeometryRequest[] = [];
  let pageStart = 0;
  while (pageStart < portions.length) {
    const pageIndex = portions[pageStart].entry.pageIndex;
    let pageEnd = pageStart;
    while (pageEnd + 1 < portions.length && portions[pageEnd + 1].entry.pageIndex === pageIndex) {
      pageEnd += 1;
    }
    const first = portions[pageStart];
    const last = portions[pageEnd];
    if (first.entry.textRange && last.entry.textRange) {
      requests.push({
        pageIndex,
        start: withCharIndex(first.entry.textRange.start, first.startCharIndex),
        end: withCharIndex(last.entry.textRange.end, last.endCharIndex),
      });
    }
    pageStart = pageEnd + 1;
  }
  return requests;
}

function withCharIndex(position: ReaderTextPosition, charIndex: number): ReaderTextPosition {
  return { ...position, charIndex };
}

function compareTextPositionDistance(
  left: ReaderSearchResult,
  right: ReaderSearchResult,
  request: ReaderTextRangeGeometryRequest,
): number {
  const leftDistance = textPositionDistance(left, request);
  const rightDistance = textPositionDistance(right, request);
  for (let index = 0; index < leftDistance.length; index += 1) {
    const difference = leftDistance[index] - rightDistance[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function textPositionDistance(result: ReaderSearchResult, request: ReaderTextRangeGeometryRequest): readonly number[] {
  return [
    Math.abs(result.start.blockIndex - request.start.blockIndex) +
      Math.abs(result.end.blockIndex - request.end.blockIndex),
    Math.abs(result.start.lineIndex - request.start.lineIndex) + Math.abs(result.end.lineIndex - request.end.lineIndex),
    Math.abs(result.start.runIndex - request.start.runIndex) + Math.abs(result.end.runIndex - request.end.runIndex),
    Math.abs(result.start.charIndex - request.start.charIndex) + Math.abs(result.end.charIndex - request.end.charIndex),
  ];
}

function isSelectable(entry: ReaderHitEntry): boolean {
  return entry.imageSource === undefined && entry.text.length > 0;
}

function contains(bounds: ReaderRect, x: number, y: number): boolean {
  return x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height;
}

function squaredDistanceToRect(bounds: ReaderRect, x: number, y: number): number {
  const dx = x < bounds.x ? bounds.x - x : x > bounds.x + bounds.width ? x - bounds.x - bounds.width : 0;
  const dy = y < bounds.y ? bounds.y - y : y > bounds.y + bounds.height ? y - bounds.y - bounds.height : 0;
  return dx * dx + dy * dy;
}

function charIndexAtPoint(entry: ReaderHitEntry, x: number, y: number): number {
  const vertical = entry.bounds.height > entry.bounds.width * 1.5;
  const extent = vertical ? entry.bounds.height : entry.bounds.width;
  const offset = vertical ? y - entry.bounds.y : x - entry.bounds.x;
  const ratio = extent > 0 ? Math.min(1, Math.max(0, offset / extent)) : 0;
  return Math.min(entry.text.length, Math.max(0, Math.round(ratio * entry.text.length)));
}

function wordRangeAt(text: string, charIndex: number): { readonly start: number; readonly end: number } {
  const safeIndex = Math.min(Math.max(0, charIndex), Math.max(0, text.length - 1));
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'word' },
      ) => {
        segment(value: string): Iterable<{ readonly segment: string; readonly index: number }>;
      };
    }
  ).Segmenter;
  if (Segmenter) {
    const segments = Array.from(new Segmenter(undefined, { granularity: 'word' }).segment(text));
    const segment = segments.find((part) => safeIndex >= part.index && safeIndex < part.index + part.segment.length);
    if (segment) return { start: segment.index, end: segment.index + segment.segment.length };
  }
  let start = safeIndex;
  let end = Math.min(text.length, safeIndex + 1);
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;
  return { start, end };
}

function portionBounds(portion: ReaderTextSelectionPortion): ReaderRect {
  const { bounds, text } = portion.entry;
  const startRatio = portion.startCharIndex / text.length;
  const endRatio = portion.endCharIndex / text.length;
  if (bounds.height > bounds.width * 1.5) {
    return {
      x: bounds.x,
      y: bounds.y + bounds.height * startRatio,
      width: bounds.width,
      height: bounds.height * (endRatio - startRatio),
    };
  }
  return {
    x: bounds.x + bounds.width * startRatio,
    y: bounds.y,
    width: bounds.width * (endRatio - startRatio),
    height: bounds.height,
  };
}

function joinSelectionText(portions: readonly ReaderTextSelectionPortion[]): string {
  let output = '';
  let previous: ReaderHitEntry | undefined;
  for (const portion of portions) {
    if (previous) output += selectionLineBreak(previous, portion.entry);
    output += portion.entry.text.slice(portion.startCharIndex, portion.endCharIndex);
    previous = portion.entry;
  }
  return output;
}

function selectionLineBreak(previousEntry: ReaderHitEntry, currentEntry: ReaderHitEntry): '' | '\n' | '\n\n' {
  const previousBlock = previousEntry.textRange?.start.blockIndex;
  const currentBlock = currentEntry.textRange?.start.blockIndex;
  if (previousBlock !== undefined && currentBlock !== undefined && previousBlock !== currentBlock) return '\n\n';

  const previous = previousEntry.bounds;
  const current = currentEntry.bounds;
  const previousCenter = previous.y + previous.height / 2;
  const currentCenter = current.y + current.height / 2;
  const distance = Math.abs(currentCenter - previousCenter);
  const lineHeight = Math.max(previous.height, current.height);
  if (distance <= lineHeight * 0.6) return '';
  return distance > lineHeight * 1.6 ? '\n\n' : '\n';
}

function compareEndpoints(left: ReaderTextSelectionEndpoint, right: ReaderTextSelectionEndpoint): number {
  return left.entryIndex === right.entryIndex ? left.charIndex - right.charIndex : left.entryIndex - right.entryIndex;
}

function minEndpoint(
  left: ReaderTextSelectionEndpoint,
  right: ReaderTextSelectionEndpoint,
): ReaderTextSelectionEndpoint {
  return compareEndpoints(left, right) <= 0 ? left : right;
}

function maxEndpoint(
  left: ReaderTextSelectionEndpoint,
  right: ReaderTextSelectionEndpoint,
): ReaderTextSelectionEndpoint {
  return compareEndpoints(left, right) >= 0 ? left : right;
}
