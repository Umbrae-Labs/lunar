import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativePageTurnEvents } from '../../src/reader/skia/anime/native/use-native-page-turn-events';
import { takeNativePagerEvents } from '../../src/reader/skia/anime/native/pager-compositor';

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
  useRef: (current: unknown) => ({ current }),
  useState: () => [undefined, vi.fn()],
}));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({ takeNativePagerEvents: vi.fn(() => []) }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

function options() {
  return { active: true, automaticActive: true, canvasRef: { current: { getNativeId: () => 1 } },
    submittedTurnIds: { current: new Set<number>() }, turns: [], onComplete: vi.fn() } as unknown as Parameters<typeof useNativePageTurnEvents>[0];
}

describe('native event polling lifetime', () => {
  it('performs no polling on a static page even when native automatic turns are enabled', () => {
    useNativePageTurnEvents(options());
    vi.advanceTimersByTime(2000);
    expect(takeNativePagerEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('polls while a turn exists and stops when its effect is released', () => {
    useNativePageTurnEvents({ ...options(), turns: [{ id: 1 } as never] });
    vi.advanceTimersByTime(48);
    expect(takeNativePagerEvents).toHaveBeenCalledTimes(4);
    for (const cleanup of cleanups.splice(0)) cleanup();
    const count = vi.mocked(takeNativePagerEvents).mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(takeNativePagerEvents).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues polling for an interactive gesture without an automatic queue', () => {
    useNativePageTurnEvents({ ...options(), automaticActive: false, interactiveTurn: { direction: 1, progress: 0.2 } });
    vi.advanceTimersByTime(32);
    expect(takeNativePagerEvents).toHaveBeenCalledTimes(3);
  });

  it('polls while the composer turns pages on taps by itself, with no turn RN scheduled', () => {
    const onNativeEvent = vi.fn();
    vi.mocked(takeNativePagerEvents).mockReturnValueOnce([
      { id: 'lunar-interactive:7:0#turn:1', event: 'consumed', eventAtMs: 0, direction: 1 },
    ] as never);
    useNativePageTurnEvents({ ...options(), automaticActive: false, nativeTapEventsActive: true, onNativeEvent });
    // Read at once: the runtime follows a tap the composer took from this event.
    expect(onNativeEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'consumed' }));
    vi.advanceTimersByTime(32);
    expect(takeNativePagerEvents).toHaveBeenCalledTimes(3);
  });
});
