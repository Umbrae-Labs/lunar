import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stockNativePagerPicture } from '../../src/reader/skia/anime/native/pager-compositor';
import { useNativeInteractivePageTurn } from '../../src/reader/skia/anime/native/use-native-interactive-page-turn';
import { curlPageTurnEffect } from '../../src/reader/skia/anime/effects/curl/strategy';
import { nativePageTextureKey } from '../../src/reader/skia/anime/native/page-texture-key';

vi.mock('react', () => ({ useEffect: (effect: () => void) => effect(), useRef: (current: unknown) => ({ current }) }));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({
  configureNativePagerInput: vi.fn(() => true),
  setNativePagerAnchor: vi.fn(() => true),
  stockNativePagerPicture: vi.fn(() => true),
}));

beforeEach(() => vi.clearAllMocks());

describe('single-page native curl stock', () => {
  it.each([1, -1] as const)('keeps the background separate from the blank back, direction=%s', (direction) => {
    const source = { key: 'source', snapshot: { revisionId: 7 } };
    const target = { key: 'target', snapshot: { revisionId: 7 } };
    const sourcePicture = { dispose: vi.fn() };
    const targetPicture = { dispose: vi.fn() };
    type Options = Parameters<typeof useNativeInteractivePageTurn>[0];
    useNativeInteractivePageTurn({
      active: true,
      canvasRef: { current: {} },
      createPicture: (content: { key: string }) => content.key === source.key ? sourcePicture : targetPicture,
      currentContent: source,
      interactiveSource: source,
      stocks: [{ token: 1, preparedTurnId: 2, direction, source, target }],
      paperColor: 0xff000000,
      pageTurnEffect: curlPageTurnEffect,
      pixelWidth: 400,
      pixelHeight: 800,
      binding: { values: { nativeInputReady: { set: vi.fn() } }, onStocked: vi.fn(), onStockLost: vi.fn() },
      turnsActive: false,
      anchorKeyRef: { current: source.key },
      submittedStockIdsRef: { current: new Set() },
    } as unknown as Options);

    expect(stockNativePagerPicture).toHaveBeenCalledOnce();
    const command = vi.mocked(stockNativePagerPicture).mock.calls[0]![1];
    expect(command.spread).toBe(false);
    expect(command.frontPageKey).toBe(nativePageTextureKey((direction > 0 ? source : target) as never));
    expect(command.frontPicture).toBe(direction > 0 ? sourcePicture : targetPicture);
    expect(command.backgroundLeftPicture).toBe(direction > 0 ? targetPicture : sourcePicture);
    expect(command.backPageKey).toBeUndefined();
    expect(command.backPicture).toBeUndefined();
    expect(sourcePicture.dispose).toHaveBeenCalledOnce();
    expect(targetPicture.dispose).toHaveBeenCalledOnce();
  });

  it('stocks both idle neighbors one recording a frame', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const source = { key: 'source', snapshot: { revisionId: 7 } };
    const next = { key: 'next', snapshot: { revisionId: 7 } };
    const previous = { key: 'previous', snapshot: { revisionId: 7 } };
    const onStocked = vi.fn();
    type Options = Parameters<typeof useNativeInteractivePageTurn>[0];
    useNativeInteractivePageTurn({
      active: true,
      canvasRef: { current: {} },
      createPicture: () => ({ dispose: vi.fn() }),
      currentContent: source,
      interactiveSource: source,
      stocks: [
        { token: 3, preparedTurnId: 0, direction: 1, source, target: next },
        { token: 4, preparedTurnId: 0, direction: -1, source, target: previous },
      ],
      paperColor: 0xff000000,
      pageTurnEffect: curlPageTurnEffect,
      pixelWidth: 400,
      pixelHeight: 800,
      binding: { values: { nativeInputReady: { set: vi.fn() } }, onStocked, onStockLost: vi.fn() },
      turnsActive: false,
      anchorKeyRef: { current: source.key },
      submittedStockIdsRef: { current: new Set() },
    } as unknown as Options);

    expect(stockNativePagerPicture).toHaveBeenCalledOnce();
    expect(onStocked).toHaveBeenLastCalledWith(3);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(stockNativePagerPicture).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stockNativePagerPicture).mock.calls[1]![1]).toMatchObject({
      fromPageKey: 'source', toPageKey: 'previous', direction: -1,
    });
    expect(onStocked).toHaveBeenLastCalledWith(4);
    vi.unstubAllGlobals();
  });

  it('anchors a consumed sheet on the page the composer stocked as its target', () => {
    const source = { key: 'source', snapshot: { revisionId: 7 } };
    const prepared = { key: 'prepared', snapshot: { revisionId: 7 } };
    const anchorKeyRef = { current: source.key as string | undefined };
    type Options = Parameters<typeof useNativeInteractivePageTurn>[0];
    useNativeInteractivePageTurn({
      active: true,
      canvasRef: { current: {} },
      createPicture: () => ({ dispose: vi.fn() }),
      currentContent: source,
      interactiveSource: source,
      interactiveTurn: {
        direction: 1, progress: 1, source, content: prepared,
        nativeGesture: { token: 3, preparedTurnId: 5, targetKey: 'stocked', driven: true, settling: false, consumed: true },
      },
      stocks: [],
      paperColor: 0xff000000,
      pageTurnEffect: curlPageTurnEffect,
      pixelWidth: 400,
      pixelHeight: 800,
      binding: { values: { nativeInputReady: { set: vi.fn() } }, onStocked: vi.fn(), onStockLost: vi.fn() },
      turnsActive: false,
      anchorKeyRef,
      submittedStockIdsRef: { current: new Set() },
    } as unknown as Options);
    expect(anchorKeyRef.current).toBe('stocked');
  });
});
