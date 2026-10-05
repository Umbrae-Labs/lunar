import { describe, expect, it, vi } from 'vitest';
import type { SkPicture } from '@shopify/react-native-skia';
import type { ReaderPageContent } from '../../src/reader/skia/anime/core/page-turn-types';
import { NativePageRecordingCache } from '../../src/reader/skia/anime/native/page-recording-cache';

const page = {} as ReaderPageContent;
function fixture() {
  const pictures: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const factory = vi.fn(() => {
    const picture = { dispose: vi.fn() };
    pictures.push(picture);
    return picture as unknown as SkPicture;
  });
  return { pictures, factory };
}

describe('native page recording ownership', () => {
  it('reuses a source page across turns and retains borrowers across eviction', () => {
    const { pictures, factory } = fixture();
    const cache = new NativePageRecordingCache(2);
    const a = cache.acquire('a', factory, page, 1);
    const anotherA = cache.acquire('a', factory, page, 1);
    expect(a.picture).toBe(anotherA.picture);
    cache.acquire('b', factory, page, 1).release();
    cache.acquire('c', factory, page, 1).release();
    expect(factory).toHaveBeenCalledTimes(3);
    expect(pictures[0].dispose).not.toHaveBeenCalled();
    a.release(); a.release();
    expect(pictures[0].dispose).not.toHaveBeenCalled();
    anotherA.release();
    expect(pictures[0].dispose).toHaveBeenCalledOnce();
    cache.clear(); cache.clear();
    for (const picture of pictures) expect(picture.dispose).toHaveBeenCalledOnce();
  });

  it('bounds memory estimates and replaces drawings when their factory changes', () => {
    const first = fixture(); const second = fixture();
    const cache = new NativePageRecordingCache(8, 10);
    cache.acquire('a', first.factory, page, 6).release();
    const b = cache.acquire('b', first.factory, page, 6);
    expect(first.pictures[0].dispose).toHaveBeenCalledOnce();
    const replacement = cache.acquire('b', second.factory, page, 6);
    expect(first.pictures[1].dispose).not.toHaveBeenCalled();
    cache.clear();
    expect(second.pictures[0].dispose).not.toHaveBeenCalled();
    b.release(); replacement.release();
    expect(first.pictures[1].dispose).toHaveBeenCalledOnce();
    expect(second.pictures[0].dispose).toHaveBeenCalledOnce();
  });

  it('keeps the old recording usable after a replacement fails', () => {
    const { pictures, factory } = fixture();
    const cache = new NativePageRecordingCache();
    cache.acquire('a', factory, page, 1).release();
    expect(() => cache.acquire('a', () => { throw new Error('recording failed'); }, page, 1)).toThrow();
    cache.acquire('a', factory, page, 1).release();
    expect(factory).toHaveBeenCalledOnce();
    cache.clear();
    expect(pictures[0].dispose).toHaveBeenCalledOnce();
  });
});
