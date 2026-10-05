import { describe, expect, it } from 'vitest';
import {
  createReaderSelectionHits,
  mergeReaderSelectionRects,
  readerSelectionRects,
} from '../../src/reader/interaction/selection-geometry';

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

  it('also joins refined native rectangles before drawing rounded corners', () => {
    expect(mergeReaderSelectionRects(entries.map(({ bounds }) => bounds))).toEqual([
      { x: 67, y: 480, width: 150, height: 33 },
      entries[3].bounds,
    ]);
    expect(mergeReaderSelectionRects([entries[0].bounds, { ...entries[1].bounds, x: 190 }])).toHaveLength(2);
  });
});
