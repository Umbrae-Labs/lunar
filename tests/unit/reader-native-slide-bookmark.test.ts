import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeInteractivePageTurn } from '../../src/reader/skia/anime/native/use-native-interactive-page-turn';
import { useNativeAutomaticPageTurnSubmission } from '../../src/reader/skia/anime/native/use-native-automatic-page-turns';
import { nativePageTextureKey } from '../../src/reader/skia/anime/native/page-texture-key';
import { readerInteractivePageTurnIdentity } from '../../src/reader/skia/anime/native/page-turn';
import { enqueueNativePagerPictureTurn, setNativePagerAnchor, stockNativePagerPicture } from '../../src/reader/skia/anime/native/pager-compositor';
import { slidePageTurnEffect } from '../../src/reader/skia/anime/effects/slide/strategy';
import type { ReaderPageContent } from '../../src/reader/skia/anime/core/page-turn-types';

const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], cursor: 0 }));
vi.mock('react', () => ({
  useEffect: (effect: () => void) => effect(),
  useRef: (value: unknown) => hooks.refs[hooks.cursor++] ?? (hooks.refs[hooks.cursor - 1] = { current: value }),
}));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({
  configureNativePagerInput: vi.fn(() => true), setNativePagerAnchor: vi.fn(() => true),
  stockNativePagerPicture: vi.fn(() => true), enqueueNativePagerPictureTurn: vi.fn(() => true),
}));
beforeEach(() => { vi.clearAllMocks(); hooks.refs = []; hooks.cursor = 0; });

function page(key: string, bookmarked: boolean): ReaderPageContent {
  return { key, bookmarked, snapshot: { revisionId: 1, chapterTitle: key } } as ReaderPageContent;
}
function fixtures(direction: 1 | -1) {
  const source = page('source', true); const target = page('target', false);
  const createPicture = vi.fn((content: ReaderPageContent) => ({ content, layer: 'body', dispose: vi.fn() }));
  const createChromePicture = vi.fn((content: ReaderPageContent) => ({ content, layer: 'chrome', dispose: vi.fn() }));
  const options = { active: true, canvasRef: { current: {} }, createPicture, createChromePicture,
    currentContent: source, interactiveSource: source, pageTurnEffect: slidePageTurnEffect,
    paperColor: 0xff000000, pixelWidth: 400, pixelHeight: 800, turnsActive: false,
    interactiveTurn: { direction, progress: 0.3, content: target,
      nativeGesture: { token: 7, preparedTurnId: 9, driven: false, consumed: false, settling: false } },
    surfaceBinding: { inputReady: { set: vi.fn() }, stockedGestureToken: { set: vi.fn() } },
    anchorKeyRef: { current: undefined }, submittedStockIdsRef: { current: new Set<string>() },
  } as unknown as Parameters<typeof useNativeInteractivePageTurn>[0];
  return { source, target, createPicture, createChromePicture, options };
}
function useRenderTurn(options: Parameters<typeof useNativeInteractivePageTurn>[0]) {
  // eslint-disable-next-line react-hooks/immutability -- Reset the mocked hook dispatcher for this test render.
  hooks.cursor = 0; useNativeInteractivePageTurn(options);
}

describe('native slide with bookmarks', () => {
  it.each([1, -1] as const)('submits moving bookmarks and independent fixed chrome, direction=%s', (direction) => {
    const { source, target, options, createPicture, createChromePicture } = fixtures(direction);
    useRenderTurn(options);
    const command = vi.mocked(stockNativePagerPicture).mock.calls[0][1];
    expect(command.fromPageKey).toBe(source.key);
    expect(command.toPageKey).toBe(target.key);
    expect(command.frontPicture).toMatchObject({ content: direction > 0 ? source : target, layer: 'body' });
    expect(command.backgroundLeftPicture).toMatchObject({ content: direction > 0 ? target : source, layer: 'body' });
    expect(command.backPicture).toMatchObject({ content: source, layer: 'chrome' });
    expect(command.backgroundRightPicture).toMatchObject({ content: target, layer: 'chrome' });
    for (const result of [...createPicture.mock.results, ...createChromePicture.mock.results]) {
      expect(result.value.dispose).toHaveBeenCalledOnce();
    }
  });

  it('refreshes the stock when a bookmark changes while preserving navigation identity', () => {
    const { options, source, target } = fixtures(1);
    useRenderTurn(options); useRenderTurn(options);
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(1);
    const updated = { ...options, interactiveTurn: { ...options.interactiveTurn!, content: { ...target, bookmarked: true } } };
    useRenderTurn(updated);
    const first = vi.mocked(stockNativePagerPicture).mock.calls[0][1];
    const second = vi.mocked(stockNativePagerPicture).mock.calls[1][1];
    expect(second.id).not.toBe(first.id);
    expect(second.backgroundLeftPageKey).not.toBe(first.backgroundLeftPageKey);
    expect(readerInteractivePageTurnIdentity(second.id)).toEqual({ gestureToken: 7, preparedTurnId: 9 });
    expect(second.fromPageKey).toBe(source.key); expect(second.toPageKey).toBe(target.key);
    useRenderTurn(options);
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(3);
    useRenderTurn({ ...updated, interactiveSource: { ...source, bookmarked: false } });
    expect(setNativePagerAnchor).toHaveBeenCalledTimes(1);
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(4);
  });

  it('retains in-flight native resources when decorations change after gesture acceptance', () => {
    const { options, source } = fixtures(1);
    useRenderTurn(options);
    useRenderTurn({ ...options, interactiveSource: { ...source, bookmarked: false },
      interactiveTurn: { ...options.interactiveTurn!, nativeGesture: { ...options.interactiveTurn!.nativeGesture!, driven: true } } });
    expect(setNativePagerAnchor).toHaveBeenCalledTimes(1);
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(1);
  });

  it('stocks the next swipe without resetting the consumed sheet that is still animating', () => {
    const { options, target } = fixtures(1);
    useRenderTurn(options);
    useRenderTurn({ ...options, currentContent: target,
      interactiveTurn: { ...options.interactiveTurn!, nativeGesture: {
        ...options.interactiveTurn!.nativeGesture!, driven: true, consumed: true,
      } },
    });
    const nextTarget = page('next', true);
    useRenderTurn({ ...options, currentContent: target, interactiveSource: target,
      interactiveTurn: { ...options.interactiveTurn!, content: nextTarget, nativeGesture: {
        ...options.interactiveTurn!.nativeGesture!, token: 8, preparedTurnId: 10,
      } },
    });
    expect(setNativePagerAnchor).toHaveBeenCalledTimes(1);
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stockNativePagerPicture).mock.calls[1][1]).toMatchObject({
      fromPageKey: target.key, toPageKey: nextTarget.key,
    });
  });

  it('reanchors after automatic taps before stocking a gesture from the final page', () => {
    const { options } = fixtures(1);
    useRenderTurn(options);
    const finalTapPage = page('final-tap', false);
    useRenderTurn({ ...options, currentContent: finalTapPage, interactiveSource: finalTapPage,
      interactiveTurn: undefined, turnsActive: true });
    expect(setNativePagerAnchor).toHaveBeenCalledTimes(1);
    useRenderTurn({ ...options, currentContent: finalTapPage, interactiveSource: finalTapPage,
      interactiveTurn: undefined });
    useRenderTurn({ ...options, currentContent: finalTapPage, interactiveSource: finalTapPage });
    expect(setNativePagerAnchor).toHaveBeenLastCalledWith(options.canvasRef.current, finalTapPage.key);
    expect(vi.mocked(stockNativePagerPicture).mock.calls.at(-1)![1].fromPageKey).toBe(finalTapPage.key);
  });

  it.each([1, -1] as const)('keeps automatic bookmarked turns native, direction=%s', (direction) => {
    const { options, source, target, createChromePicture } = fixtures(direction);
    const onRejected = vi.fn();
    useNativeAutomaticPageTurnSubmission({ ...options,
      turns: [{ id: 1, from: source, to: target, direction }], submittedTurnIds: { current: new Set() }, onRejected,
    } as Parameters<typeof useNativeAutomaticPageTurnSubmission>[0]);
    expect(enqueueNativePagerPictureTurn).toHaveBeenCalledOnce();
    expect(createChromePicture).toHaveBeenCalledTimes(2);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('changes texture identity for appearance edits without changing the logical page key', () => {
    const plain = page('page', false); const marked = { ...plain, bookmarked: true };
    expect(nativePageTextureKey(plain)).not.toBe(nativePageTextureKey(marked));
    expect(nativePageTextureKey(marked)).not.toBe(nativePageTextureKey(marked, 'chrome'));
    expect(nativePageTextureKey({ ...marked })).toBe(nativePageTextureKey(marked));
    expect(marked.key).toBe(plain.key);
  });
});
