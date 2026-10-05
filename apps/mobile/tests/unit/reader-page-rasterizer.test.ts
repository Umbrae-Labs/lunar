import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installRasterTexture, rasterizePageOnWorker } from '../../src/reader/skia/anime/effects/curl/page-rasterizer';
import { runOnRuntimeAsync } from 'react-native-worklets';

const state = vi.hoisted(() => ({
  image: { dispose: vi.fn() },
  source: { dispose: vi.fn() },
  retained: { dispose: vi.fn() },
  draw: vi.fn(), surfaceDispose: vi.fn(), recorderDispose: vi.fn(),
  make: vi.fn(),
}));
vi.mock('react-native-worklets', () => ({
  createWorkletRuntime: () => ({}),
  runOnRuntimeAsync: vi.fn((_runtime: unknown, action: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise.resolve(action(...args))),
  scheduleOnRN: (action: (...args: unknown[]) => unknown, ...args: unknown[]) => action(...args),
}));
vi.mock('@shopify/react-native-skia', () => ({ Skia: {
  Color: (color: string) => color,
  XYWHRect: () => ({}),
  Surface: { Make: state.make },
  PictureRecorder: () => ({
    beginRecording: () => ({ drawPicture: vi.fn() }),
    finishRecordingAsPicture: () => state.retained,
    dispose: state.recorderDispose,
  }),
} }));
beforeEach(() => {
  vi.clearAllMocks();
  state.draw.mockReset();
  state.make.mockReturnValue({
    getCanvas: () => ({ clear() {}, scale() {}, drawPicture: state.draw }),
    flush() {}, makeImageSnapshot: () => state.image, dispose: state.surfaceDispose,
  });
});

describe('Android page raster ownership', () => {
  it('releases the independent recording if transfer to the worker fails', async () => {
    vi.mocked(runOnRuntimeAsync).mockRejectedValueOnce(new Error('transfer failed'));
    expect(await rasterizePageOnWorker(state.source as never, 100, 200, 1, false)).toEqual({ image: null });
    expect(state.retained.dispose).toHaveBeenCalledOnce();
    expect(state.source.dispose).not.toHaveBeenCalled();
  });
  it('rasterizes borrowed content through an independent recording', async () => {
    const result = await rasterizePageOnWorker(state.source as never, 100, 200, 2, false);
    expect(result.image).toBe(state.image);
    expect(result.timing).toBeUndefined();
    expect(state.make).toHaveBeenCalledWith(200, 400);
    expect(state.draw).toHaveBeenCalledWith(state.retained);
    expect(state.source.dispose).not.toHaveBeenCalled();
    expect(state.retained.dispose).toHaveBeenCalledOnce();
    expect(state.surfaceDispose).toHaveBeenCalledOnce();
  });

  it('releases owned resources when raster drawing fails', async () => {
    state.draw.mockImplementation(() => { throw new Error('draw failed'); });
    expect(await rasterizePageOnWorker(state.source as never, 100, 200, 1, true)).toEqual({ image: null });
    expect(state.source.dispose).toHaveBeenCalledOnce();
    expect(state.surfaceDispose).toHaveBeenCalledOnce();
  });

  it('discards completed work after cancellation without replacing the visible texture', () => {
    const current = { dispose: vi.fn() };
    const texture = { value: current };
    const ready = vi.fn();
    installRasterTexture(texture as never, { value: null } as never, { value: 3 } as never,
      2, 'old-page', state.image as never, ready);
    expect(texture.value).toBe(current);
    expect(state.image.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it('replaces the texture before releasing the previous surface and reporting readiness', () => {
    const previous = { dispose: vi.fn() }; const surface = { dispose: vi.fn() };
    const texture = { value: previous }; const backing = { value: surface };
    const ready = vi.fn(() => expect(texture.value).toBe(state.image));
    installRasterTexture(texture as never, backing as never, { value: 2 } as never,
      2, 'page', state.image as never, ready);
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(surface.dispose).toHaveBeenCalledOnce();
    expect(backing.value).toBeNull();
    expect(ready).toHaveBeenCalledOnce();
  });
});
