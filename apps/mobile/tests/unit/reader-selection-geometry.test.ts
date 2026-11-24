import { describe, expect, it } from 'vitest';
import {
  createReaderSelectionHits,
  mergeReaderSelectionRects,
  readerSelectionRects,
} from '../../src/reader/interaction/selection-geometry';

import { readerRangeLineBounds } from '../../src/reader/interaction/selection-line-bounds';

describe('reader selection line geometry', () => {
  const entries = [
    { pageIndex: 0, text: '「这样就好了', bounds: { x: 67, y: 480, width: 120, height: 33 } },
    { pageIndex: 0, text: '。', bounds: { x: 187, y: 480, width: 10, height: 33 } },
    { pageIndex: 0, text: '」', bounds: { x: 197, y: 480, width: 20, height: 33 } },
    { pageIndex: 0, text: '下一行', bounds: { x: 67, y: 533, width: 60, height: 33 } },
  ];

  it('keeps narrow punctuation joined to both neighboring runs while dragging', () => {
    const rects = readerSelectionRects(createReaderSelectionHits(entries), {
      start: { entryIndex: 0, charIndex: 0 },
      end: { entryIndex: 3, charIndex: 3 },
    });
    expect(rects).toEqual([{ x: 67, y: 480, width: 150, height: 33 }, entries[3].bounds]);
  });

  it('joins exact font boxes without a hit map only within consecutive lines of one paragraph and page', () => {
    const run = (y: number, pageIndex: number, blockIndex: number, lineIndex: number) => ({
      pageIndex,
      blockIndex,
      lineIndex,
      runIndex: 0,
      bounds: { x: 10, y, width: 100, height: 20 },
    });
    const rects = [run(0, 0, 0, 0), run(30, 0, 0, 1), run(70, 0, 1, 0), run(110, 1, 1, 1)];
    expect(readerRangeLineBounds([], rects)).toEqual([
      { x: 10, y: 0, width: 100, height: 25 },
      { x: 10, y: 25, width: 100, height: 25 },
      rects[2].bounds,
      rects[3].bounds,
    ]);
  });

  it('also joins refined native rectangles before drawing rounded corners', () => {
    expect(mergeReaderSelectionRects(entries.map(({ bounds }) => bounds))).toEqual([
      { x: 67, y: 480, width: 150, height: 33 },
      entries[3].bounds,
    ]);
    expect(mergeReaderSelectionRects([entries[0].bounds, { ...entries[1].bounds, x: 190 }])).toHaveLength(2);
  });
});
