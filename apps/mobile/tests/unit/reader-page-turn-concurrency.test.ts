import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_PAGE_TURN_MAX_LANES,
  AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
  appendAutomaticPageTurn,
  automaticPageTurnPaintOrder,
  automaticPageTurnTransition,
} from '../../src/reader/skia/anime/core/page-turn-concurrency';
import type {
  ReaderAutomaticTurn,
  ReaderPageContent,
} from '../../src/reader/skia/anime/core/page-turn-types';

function turn(id: number, direction: 1 | -1 = 1): ReaderAutomaticTurn {
  const content = {} as ReaderPageContent;
  return {
    id,
    from: content,
    to: content,
    direction,
  };
}

describe('reader page turn concurrency', () => {
  it('uses the reference tap cadence and tap lane capacity', () => {
    expect(AUTOMATIC_PAGE_TURN_START_INTERVAL_MS).toBe(100);
    expect(AUTOMATIC_PAGE_TURN_MAX_LANES).toBe(10);
  });

  it('preserves existing sheet objects when another turn is appended', () => {
    const single = appendAutomaticPageTurn([], turn(1));
    const first = single[0];
    const concurrent = appendAutomaticPageTurn(single, turn(2));

    expect(concurrent.map((value) => value.id)).toEqual([1, 2]);
    expect(concurrent[0]).toBe(first);
  });

  it('uses the reference paint order for each direction', () => {
    const turns = [turn(1), turn(2), turn(3)];

    expect(automaticPageTurnPaintOrder(turns, 1).map((value) => value.id))
      .toEqual([3, 2, 1]);
    expect(automaticPageTurnPaintOrder(turns, -1).map((value) => value.id))
      .toEqual([1, 2, 3]);
  });

  it('preserves an explicit previous direction when pagination reuses the spread slot', () => {
    const from = {
      key: '2:0:1',
      snapshot: { revisionId: 2, spreadIndex: 0, renderId: 1 },
    } as ReaderPageContent;
    const to = {
      key: '2:0:2',
      snapshot: { revisionId: 2, spreadIndex: 0, renderId: 2 },
    } as ReaderPageContent;

    const transition = automaticPageTurnTransition({
      id: 1,
      from,
      to,
      direction: -1,
    });

    expect(transition).toEqual({
      from,
      toKey: '2:0:2',
      direction: -1,
    });
  });
});
