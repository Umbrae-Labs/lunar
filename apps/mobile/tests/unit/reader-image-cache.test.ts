import { describe, expect, it } from 'vitest';

import { ReaderImageByteCache } from '../../src/reader/runtime/cache/reader-image-cache';

describe('ReaderImageByteCache', () => {
  it('evicts the least recently used bytes while protecting the current frame', () => {
    const cache = new ReaderImageByteCache(5);
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5, 6]);
    cache.set('first', first, ['first']);
    cache.set('second', second, ['second']);

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe(second);
  });

  it('clears all encoded bytes at the end of a runtime', () => {
    const cache = new ReaderImageByteCache(16);
    cache.set('cover', new Uint8Array([1]));
    cache.clear();

    expect(cache.get('cover')).toBeUndefined();
  });
});
