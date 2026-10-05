import { describe, expect, it, vi } from 'vitest';
import {
  mergeReaderOverlayRects,
  resolveReaderSearchOverlays,
} from '../../src/reader/skia/rendering/reader-overlays';

vi.mock('@shopify/react-native-skia', () => ({ PaintStyle: {}, Skia: {} }));

describe('reader overlay geometry', () => {
  it('resolves search endpoints into revision-owned overlays', async () => {
    const source = {
      resolveTextRangeGeometry: vi.fn(async () => [{
        bounds: { x: 12, y: 20, width: 30, height: 16 },
        blockIndex: 0, lineIndex: 1, runIndex: 2, startCharIndex: 3, endCharIndex: 5,
      }]),
    };
    const overlays = await resolveReaderSearchOverlays(source, 7, [{
      pageIndex: 4,
      spreadIndex: 2,
      start: { blockIndex: 0, lineIndex: 1, runIndex: 2, charIndex: 3 },
      end: { blockIndex: 0, lineIndex: 1, runIndex: 2, charIndex: 5 },
      context: '检索结果',
    }], { color: '#ffcc00' });
    expect(source.resolveTextRangeGeometry).toHaveBeenCalledWith({
      pageIndex: 4,
      start: { blockIndex: 0, lineIndex: 1, runIndex: 2, charIndex: 3 },
      end: { blockIndex: 0, lineIndex: 1, runIndex: 2, charIndex: 5 },
    });
    expect(overlays).toEqual([{
      revisionId: 7,
      bounds: { x: 12, y: 20, width: 30, height: 16 },
      color: '#ffcc00',
    }]);
  });

  it('joins adjacent font-run rectangles without leaving a painted seam', () => {
    expect(mergeReaderOverlayRects([
      { revisionId: 7, bounds: { x: 10, y: 20, width: 30, height: 16 }, color: '#ffcc00' },
      { revisionId: 7, bounds: { x: 40.5, y: 20, width: 20, height: 16 }, color: '#ffcc00' },
      { revisionId: 7, bounds: { x: 10, y: 42, width: 25, height: 16 }, color: '#ffcc00' },
    ])).toEqual([
      { revisionId: 7, bounds: { x: 10, y: 20, width: 50.5, height: 16 }, color: '#ffcc00' },
      { revisionId: 7, bounds: { x: 10, y: 42, width: 25, height: 16 }, color: '#ffcc00' },
    ]);
  });
});
