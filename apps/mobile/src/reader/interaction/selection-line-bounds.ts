import type { ReaderHitEntry, ReaderRect } from '../contracts';

interface PositionedRect {
  readonly pageIndex: number;
  readonly blockIndex?: number;
  readonly lineIndex?: number;
  readonly bounds: ReaderRect;
  readonly unpositionedText?: boolean;
}

/** Share the leading between consecutive lines of one paragraph, retaining run widths. */
function continuousReaderLineBounds(runs: readonly PositionedRect[]): readonly ReaderRect[] {
  const result = runs.map((run) => run.bounds);
  let previousEnd: number | undefined;
  let previousStart = 0;
  for (let start = 0; start < runs.length;) {
    const line = runs[start];
    let end = start + 1;
    let top = line.bounds.y;
    let bottom = top + line.bounds.height;
    while (end < runs.length) {
      const next = runs[end];
      const sameLine =
        line.lineIndex !== undefined
          ? next.lineIndex === line.lineIndex && next.blockIndex === line.blockIndex
          : line.unpositionedText && next.unpositionedText && next.bounds.y === line.bounds.y;
      if (
        !sameLine ||
        next.pageIndex !== line.pageIndex ||
        next.bounds.y >= bottom ||
        next.bounds.y + next.bounds.height <= top
      )
        break;
      top = Math.min(top, next.bounds.y);
      bottom = Math.max(bottom, next.bounds.y + next.bounds.height);
      end += 1;
    }
    const previous = runs[previousStart];
    const consecutive =
      line.blockIndex !== undefined
        ? line.blockIndex === previous.blockIndex &&
          previous.lineIndex !== undefined &&
          line.lineIndex === previous.lineIndex + 1
        : previous.unpositionedText &&
          line.unpositionedText &&
          previousEnd !== undefined &&
          top - previousEnd <= Math.min(previous.bounds.height, line.bounds.height) * 0.6;
    if (consecutive && previousEnd !== undefined && top > previousEnd && previous.pageIndex === line.pageIndex) {
      top = (previousEnd + top) / 2;
      for (let i = previousStart; i < start; i++) {
        result[i] = { ...result[i], height: top - result[i].y };
      }
    }
    for (let i = start; i < end; i++) {
      const rect = result[i];
      if (rect.y !== top || rect.height !== bottom - top) result[i] = { ...rect, y: top, height: bottom - top };
    }
    previousEnd = bottom;
    previousStart = start;
    start = end;
  }
  return result;
}

// A frame's hit entries are immutable. Share this projection across selections and saved marks.
const frameBounds = new WeakMap<readonly ReaderHitEntry[], readonly ReaderRect[]>();

export function readerHitLineBounds(entries: readonly ReaderHitEntry[]): readonly ReaderRect[] {
  const cached = frameBounds.get(entries);
  if (cached) return cached;
  const bounds = continuousReaderLineBounds(
    entries.map((entry) => ({
      bounds: entry.bounds,
      pageIndex: entry.pageIndex,
      blockIndex: entry.textRange?.start.blockIndex,
      lineIndex: entry.textRange?.start.lineIndex,
      unpositionedText: !entry.textRange && !entry.imageSource && !!entry.text.length,
    })),
  );
  frameBounds.set(entries, bounds);
  return bounds;
}

type RangeRect = PositionedRect & {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
};

const frameRuns = new WeakMap<readonly ReaderHitEntry[], Map<string, ReaderRect>>();

function runKey(page: number, block: number, line: number, run: number): string {
  return `${page}:${block}:${line}:${run}`;
}

/** Keep Rito's exact horizontal endpoints and use the same line boxes as the drag preview. */
export function readerRangeLineBounds(
  entries: readonly ReaderHitEntry[],
  rects: readonly RangeRect[],
): readonly ReaderRect[] {
  if (rects.length === 0) return [];
  let runs = frameRuns.get(entries);
  if (!runs) {
    runs = new Map();
    const lines = readerHitLineBounds(entries);
    for (const [index, entry] of entries.entries()) {
      const pos = entry.textRange?.start;
      if (pos) runs.set(runKey(entry.pageIndex, pos.blockIndex, pos.lineIndex, pos.runIndex), lines[index]);
    }
    frameRuns.set(entries, runs);
  }
  const index = runs;
  return continuousReaderLineBounds(
    rects.map((rect) => {
      const line = index.get(runKey(rect.pageIndex, rect.blockIndex, rect.lineIndex, rect.runIndex));
      return line ? { ...rect, bounds: { ...rect.bounds, y: line.y, height: line.height } } : rect;
    }),
  );
}
