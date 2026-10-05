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
      interactiveTurn: {
        direction, content: target,
        nativeGesture: { token: 1, preparedTurnId: 2, driven: false },
      },
      paperColor: 0xff000000,
      pageTurnEffect: curlPageTurnEffect,
      pixelWidth: 400,
      pixelHeight: 800,
      surfaceBinding: {
        inputReady: { set: vi.fn() }, stockedGestureToken: { set: vi.fn() },
      },
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
});
