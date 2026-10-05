import { describe, expect, it } from 'vitest';
import { LinearReaderHitTester } from '../../src/reader/interaction/hit-testing';

describe('reader hit testing', () => {
  it('returns source anchors for text and link targets', () => {
    const tester = new LinearReaderHitTester();
    tester.setHitMap({ pageIndex: 0, entries: [{
      pageIndex: 0,
      bounds: { x: 10, y: 20, width: 50, height: 20 },
      text: '正文',
      href: 'chapter.xhtml#note',
      sourcePoint: { nodePath: [1, 3], textOffset: 8 },
    }] });
    expect(tester.hitTest(20, 25)).toEqual({
      type: 'link',
      href: 'chapter.xhtml#note',
      imageSource: undefined,
      sourcePoint: { nodePath: [1, 3], textOffset: 8 },
    });
    expect(tester.hitTest(0, 0)).toBeUndefined();
  });
});
