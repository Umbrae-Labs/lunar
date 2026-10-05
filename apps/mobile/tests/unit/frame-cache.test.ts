import { describe, expect, it, vi } from 'vitest';

import { FrameCache } from '../../src/reader/runtime/cache/frame-cache';

describe('FrameCache', () => {
  it('evicts the least recently used frame', () => {
    const dispose = vi.fn<(value: string) => void>();
    const cache = new FrameCache<string>(2, dispose);

    cache.set({ revisionId: 1, spreadIndex: 0 }, 'zero');
    cache.set({ revisionId: 1, spreadIndex: 1 }, 'one');
    cache.get({ revisionId: 1, spreadIndex: 0 });
    cache.set({ revisionId: 1, spreadIndex: 2 }, 'two');

    expect(cache.get({ revisionId: 1, spreadIndex: 1 })).toBeUndefined();
    expect(cache.get({ revisionId: 1, spreadIndex: 0 })).toBe('zero');
    expect(dispose).toHaveBeenCalledWith('one');
  });

  it('removes every frame from a stale revision', () => {
    const dispose = vi.fn<(value: string) => void>();
    const cache = new FrameCache<string>(3, dispose);

    cache.set({ revisionId: 1, spreadIndex: 0 }, 'old');
    cache.set({ revisionId: 2, spreadIndex: 0 }, 'current');
    cache.deleteRevision(1);

    expect(cache.get({ revisionId: 1, spreadIndex: 0 })).toBeUndefined();
    expect(cache.get({ revisionId: 2, spreadIndex: 0 })).toBe('current');
    expect(dispose).toHaveBeenCalledWith('old');
  });

  it('resolves a render identity after it moves to another slot', () => {
    const cache = new FrameCache<string>(3);

    cache.set({ revisionId: 1, spreadIndex: 0, renderId: 7 }, 'compiled-picture');

    expect(cache.getByRenderId(1, 7)).toBe('compiled-picture');
    expect(cache.getByRenderId(2, 7)).toBeUndefined();
  });
});
