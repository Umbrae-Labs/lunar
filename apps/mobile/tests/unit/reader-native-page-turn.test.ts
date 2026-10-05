import { describe, expect, it } from 'vitest';

import {
  nativeAutomaticPageTurnBaseContent,
  nativeAutomaticPageTurnFaces,
  nativeAutomaticPageTurnId,
  nativeInteractivePageTurnStockId,
  nativeInteractivePageTurnBaseContent,
  readerAutomaticPageTurnId,
  readerInteractivePageTurnIdentity,
} from '../../src/reader/skia/anime/native/page-turn';
import type {
  ReaderAutomaticTurn,
  ReaderPageContent,
} from '../../src/reader/skia/anime/core/page-turn-types';

function turn(direction: 1 | -1): ReaderAutomaticTurn {
  return {
    id: 7,
    from: { key: 'from' } as ReaderPageContent,
    to: { key: 'to' } as ReaderPageContent,
    direction,
  };
}

describe('reader native automatic page turn', () => {
  it('maps forward and backward sheets to the native front and background', () => {
    const forward = nativeAutomaticPageTurnFaces(turn(1));
    const backward = nativeAutomaticPageTurnFaces(turn(-1));

    expect([forward.front.key, forward.background.key]).toEqual(['from', 'to']);
    expect([backward.front.key, backward.background.key]).toEqual(['to', 'from']);
  });

  it('round trips valid native turn identifiers', () => {
    const nativeId = nativeAutomaticPageTurnId(42);

    expect(nativeId).toBe('lunar-automatic:42');
    expect(readerAutomaticPageTurnId(nativeId)).toBe(42);
  });

  it('rejects malformed native turn identifiers', () => {
    expect(readerAutomaticPageTurnId('other:42')).toBeUndefined();
    expect(readerAutomaticPageTurnId('lunar-automatic:0')).toBeUndefined();
    expect(readerAutomaticPageTurnId('lunar-automatic:1.5')).toBeUndefined();
    expect(readerAutomaticPageTurnId('lunar-automatic:text')).toBeUndefined();
  });

  it('round trips interactive stock and generated turn identifiers', () => {
    const stockId = nativeInteractivePageTurnStockId(12, 34);

    expect(stockId).toBe('lunar-interactive:12:34');
    expect(readerInteractivePageTurnIdentity(stockId)).toEqual({
      gestureToken: 12,
      preparedTurnId: 34,
    });
    expect(readerInteractivePageTurnIdentity(`${stockId}#turn:5`)).toEqual({
      gestureToken: 12,
      preparedTurnId: 34,
    });
  });

  it('rejects malformed interactive turn identifiers', () => {
    expect(readerInteractivePageTurnIdentity('lunar-interactive:0:1')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:0')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:2:3')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:2#turn:text')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-automatic:1')).toBeUndefined();
  });

  it('places the target below a consumed native gesture handoff', () => {
    const source = { key: 'source' } as ReaderPageContent;
    const target = { key: 'target' } as ReaderPageContent;
    const gesture = {
      token: 1,
      preparedTurnId: 2,
      driven: true,
      settling: true,
      consumed: false,
    };

    expect(nativeInteractivePageTurnBaseContent(source, target, gesture)).toBe(source);
    expect(nativeInteractivePageTurnBaseContent(source, target, {
      ...gesture,
      consumed: true,
    })).toBe(target);
    expect(nativeInteractivePageTurnBaseContent(source, target, {
      ...gesture,
      driven: false,
    })).toBeUndefined();
  });

  it('keeps the source until presentation, then keeps the prepared target under the native frame', () => {
    const source = { key: 'source' } as ReaderPageContent;
    const target = { key: 'target' } as ReaderPageContent;
    const current = { key: 'current' } as ReaderPageContent;
    const turns: readonly ReaderAutomaticTurn[] = [{
      id: 1,
      from: source,
      to: target,
      direction: 1,
    }];

    expect(nativeAutomaticPageTurnBaseContent(turns, current, undefined)).toBe(source);
    expect(nativeAutomaticPageTurnBaseContent(turns, current, 1)).toBe(target);
    const queuedTurns: readonly ReaderAutomaticTurn[] = [
      ...turns,
      { id: 2, from: target, to: current, direction: 1 },
    ];
    expect(nativeAutomaticPageTurnBaseContent(queuedTurns, current, 1)).toBe(target);
    expect(nativeAutomaticPageTurnBaseContent(queuedTurns, current, 2)).toBe(current);
    expect(nativeAutomaticPageTurnBaseContent(queuedTurns.slice(1), current, undefined)).toBe(target);
  });

  it('uses current content when native animation is idle', () => {
    const current = { key: 'current' } as ReaderPageContent;

    expect(nativeAutomaticPageTurnBaseContent([], current, undefined)).toBe(current);
  });
});
