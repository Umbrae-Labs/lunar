import { describe, expect, it } from 'vitest';

import {
  nativeInteractivePageTurnStockId,
  readerInteractivePageTurnIdentity,
} from '../../src/reader/skia/anime/native/page-turn';

describe('reader native page turn identifiers', () => {
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

  it('identifies a pair stocked at idle before any turn was prepared for it', () => {
    const stockId = nativeInteractivePageTurnStockId(12, 0, 3);
    expect(readerInteractivePageTurnIdentity(`${stockId}#turn:1`)).toEqual({ gestureToken: 12, preparedTurnId: 0 });
  });

  it('rejects malformed interactive turn identifiers', () => {
    expect(readerInteractivePageTurnIdentity('lunar-interactive:0:1')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:-1')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:2:3')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-interactive:1:2#turn:text')).toBeUndefined();
    expect(readerInteractivePageTurnIdentity('lunar-automatic:1')).toBeUndefined();
  });
});
