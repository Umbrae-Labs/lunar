import { describe, expect, it } from 'vitest';

import {
  LibraryGridSelectionSession,
  libraryItemIndexAtPoint,
  resolveLibraryGridEdgeScroll,
} from '../../src/features/library/components/library-grid-selection';

const VIEWPORT_WIDTH = 320;

describe('library grid selection', () => {
  it('maps visible points to their three-column item indexes', () => {
    expect(indexAt(60, 105)).toBe(0);
    expect(indexAt(160, 105)).toBe(1);
    expect(indexAt(260, 105)).toBe(2);
    expect(indexAt(60, 299)).toBe(3);
    expect(indexAt(260, 299)).toBe(5);
  });

  it('accounts for vertical scrolling and rejects points outside the grid', () => {
    expect(indexAt(60, 105, 194)).toBe(3);
    expect(indexAt(9, 105)).toBeUndefined();
    expect(indexAt(311, 105)).toBeUndefined();
    expect(indexAt(60, 7)).toBeUndefined();
    expect(indexAt(260, 493, 0, 6)).toBeUndefined();
  });

  it('selects every crossed book once and skips non-book items', () => {
    const session = new LibraryGridSelectionSession();
    session.update({
      itemIds: ['a', undefined, 'b', 'c', 'd', 'e'],
      viewportWidth: VIEWPORT_WIDTH,
    });

    expect(session.begin({ x: 60, y: 105 })).toEqual(['a']);
    expect(session.continue({ x: 260, y: 299 })).toEqual(['b', 'c', 'd', 'e']);
    expect(session.continue({ x: 160, y: 105 })).toEqual([]);

    session.finish();
    expect(session.begin({ x: 260, y: 105 })).toEqual(['b']);
  });

  it('converts window coordinates before selecting crossed books', () => {
    const session = new LibraryGridSelectionSession();
    session.update({
      itemIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      viewportWidth: VIEWPORT_WIDTH,
      windowOriginX: 20,
      windowOriginY: 80,
    });

    expect(session.beginFromWindow({ x: 80, y: 185 })).toEqual(['a']);
    expect(session.continueFromWindow({ x: 280, y: 379 })).toEqual([
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('scrolls toward either visible grid edge and keeps selection above the toolbar', () => {
    const options = {
      obscuredBottomHeight: 130,
      viewportHeight: 600,
      windowOriginY: 100,
    };

    expect(resolveLibraryGridEdgeScroll(200, options).scrollVelocity).toBe(0);
    expect(resolveLibraryGridEdgeScroll(110, options).scrollVelocity).toBeLessThan(0);
    expect(resolveLibraryGridEdgeScroll(560, options).scrollVelocity).toBeGreaterThan(0);
    expect(resolveLibraryGridEdgeScroll(80, options).selectionWindowY).toBe(100);
    expect(resolveLibraryGridEdgeScroll(620, options).selectionWindowY).toBe(569);
  });
});

function indexAt(
  x: number,
  y: number,
  scrollOffset = 0,
  itemCount = 9,
): number | undefined {
  return libraryItemIndexAtPoint(
    { x, y },
    { itemCount, scrollOffset, viewportWidth: VIEWPORT_WIDTH },
  );
}
