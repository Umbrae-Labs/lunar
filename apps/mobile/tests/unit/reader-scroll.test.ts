import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderRenderFrame, ReaderSnapshot } from '../../src/reader/contracts';
import type { LunarReaderRuntime, ReaderAdjacentPage } from '../../src/reader/runtime/core/native-reader-runtime';
import {
  ReaderScrollCoordinator,
  type ReaderScrollValues,
} from '../../src/reader/skia/anime/scroll/reader-scroll-coordinator';
import { nativeScrollTextureKey } from '../../src/reader/skia/anime/native/page-texture-key';
import {
  mergeScrollWindows,
  placeScrollWindows,
  scrollBounds,
  scrollJumpOffset,
  scrollWindowAt,
} from '../../src/reader/skia/anime/scroll/scroll-strip';

vi.mock('react-native-worklets', () => ({ runOnUI: (fn: (...args: unknown[]) => unknown) => fn }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('scroll strip geometry', () => {
  it('places neighbors against the visible window and stops at a gap', () => {
    const placements = placeScrollWindows({ key: 'v', length: 800 }, 1000, [
      { key: 'n2', direction: 'next', distance: 2, length: 300 },
      { key: 'n1', direction: 'next', distance: 1, length: 800 },
      { key: 'p1', direction: 'previous', distance: 1, length: 800 },
      { key: 'p3', direction: 'previous', distance: 3, length: 800 },
    ]);
    expect(placements).toEqual([
      { key: 'p1', top: 200, length: 800 },
      { key: 'v', top: 1000, length: 800 },
      { key: 'n1', top: 1800, length: 800 },
      { key: 'n2', top: 2600, length: 300 },
    ]);
    expect(scrollWindowAt(placements, 1799.5)).toBe(1);
    expect(scrollWindowAt(placements, 1800)).toBe(2);
    expect(scrollWindowAt(placements, 2900)).toBeUndefined();
  });

  it('bounds the scroll by the placed windows and never strands the current offset', () => {
    const placements = [
      { key: 'a', top: 0, length: 800 },
      { key: 'b', top: 800, length: 300 },
    ];
    expect(scrollBounds(placements, 800, 100)).toEqual({ min: 0, max: 300 });
    // A last window shorter than the view still lets its top be reached.
    expect(scrollBounds([{ key: 'b', top: 800, length: 300 }], 800, 800)).toEqual({ min: 800, max: 800 });
    expect(scrollBounds(placements, 800, 900)).toEqual({ min: 0, max: 900 });
  });

  it('keeps earlier windows that continue a peek cut short on one side', () => {
    const earlier = [
      { key: 'p1', top: -800, length: 800 },
      { key: 'v', top: 0, length: 800 },
      { key: 'n1', top: 800, length: 800 },
      { key: 'n2', top: 1600, length: 300 },
      { key: 'far', top: 5000, length: 800 },
    ];
    const fresh = [
      { key: 'q2', top: -1600, length: 800 },
      { key: 'q1', top: -800, length: 800 },
      { key: 'v', top: 0, length: 800 },
      { key: 'm1', top: 800, length: 800 },
    ];
    expect(mergeScrollWindows(fresh, earlier, 'v', 2).map((window) => window.key)).toEqual([
      'q2',
      'q1',
      'v',
      'm1',
      'n2',
    ]);
    expect(mergeScrollWindows(fresh.slice(2, 3), earlier, 'v', 1).map((window) => window.key)).toEqual([
      'p1',
      'v',
      'n1',
    ]);
  });

  it('shows a jumped-to line at the top of the content box', () => {
    expect(scrollJumpOffset(0, 1, 48, 300)).toBe(252);
    expect(scrollJumpOffset(100, 2, 48, 300)).toBe(604);
    expect(scrollJumpOffset(100, 2, 48, undefined)).toBe(100);
  });
});

const VIEW = { viewportWidth: 400, viewportHeight: 800 };

function frame(spread: number, length = 800, targetOffset?: number): ReaderRenderFrame {
  return {
    spreadIndex: spread,
    pageIndices: [spread],
    width: 400,
    height: 800,
    imageSources: [],
    renderKey: `render-${spread}`,
    displayList: {} as ReaderRenderFrame['displayList'],
    scrollWindow: { length, targetOffset },
  };
}

function shared<T>(value: T) {
  return {
    value,
    get() {
      return this.value;
    },
    set(next: T) {
      this.value = next;
    },
  };
}

function fixture() {
  let snapshot: ReaderSnapshot = { phase: 'ready', revisionId: 1, spreadIndex: 0, renderId: 10 } as ReaderSnapshot;
  const frames = new Map<number, ReaderRenderFrame>([[0, frame(0, 800, 300)]]);
  const listeners = new Set<(snapshot: ReaderSnapshot) => void>();
  const emit = (next: ReaderSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(next);
  };
  const page = (direction: 'next' | 'previous', distance: number, spread: number, length = 800): ReaderAdjacentPage => {
    const pageFrame = frame(spread, length);
    frames.set(spread, pageFrame);
    return {
      direction,
      distance,
      snapshot: { phase: 'ready', revisionId: 1, spreadIndex: spread, renderId: spread + 10 } as ReaderSnapshot,
      picture: { picture: {} } as ReaderAdjacentPage['picture'],
      frame: pageFrame,
    };
  };
  const runtime = {
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: ReaderSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentPicture: () => ({ picture: {} }),
    getCurrentFrame: (spread: number) => frames.get(spread),
    getLayoutMargins: () => ({ top: 48, right: 20, bottom: 40, left: 20 }),
    canNavigate: vi.fn(() => true),
    peekAdjacentPages: vi.fn(async () => [page('next', 1, 1), page('next', 2, 2, 300), page('previous', 1, -1)]),
    next: vi.fn(async () => {
      emit({ phase: 'ready', revisionId: 1, spreadIndex: 1, renderId: 11 } as ReaderSnapshot);
      return snapshot;
    }),
    previous: vi.fn(async () => snapshot),
    refineReadingPosition: vi.fn(async () => undefined),
  };
  const values = {
    offset: shared(0),
    minOffset: shared(0),
    maxOffset: shared(0),
    visibleTop: shared(0),
    visibleLength: shared(0),
    readingLine: shared(0),
    pendingStep: shared(0),
    holding: shared(false),
  } as unknown as ReaderScrollValues;
  const coordinator = new ReaderScrollCoordinator(runtime as unknown as LunarReaderRuntime, values, VIEW);
  return { coordinator, runtime, values, emit, frames };
}

describe('scroll coordinator', () => {
  it('opens at the line the navigation landed on and places the neighbors around it', async () => {
    const { coordinator, values } = fixture();
    coordinator.attach();
    expect(values.offset.value).toBe(300 - 48);
    expect(values.readingLine.value).toBe(48);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.getState().windows.map((window) => [window.content.snapshot.spreadIndex, window.top])).toEqual([
      [-1, -800],
      [0, 0],
      [1, 800],
      [2, 1600],
    ]);
    expect(values.minOffset.value).toBe(-800);
    expect(values.maxOffset.value).toBe(1600 + 300 - 800);
  });

  it('turns the runtime with the reading line and keeps the window where the strip placed it', async () => {
    const { coordinator, runtime, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    values.offset.value = 790;
    coordinator.step(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.next).toHaveBeenCalledOnce();
    expect(coordinator.getState().visibleKey).toBe('1:1:11');
    expect(values.offset.value).toBe(790);
    expect(values.visibleTop.value).toBe(800);
    expect(values.pendingStep.value).toBe(0);
  });

  it('recognizes a stepped-to window relabelled under another slot by what it paints', async () => {
    const { coordinator, runtime, values, emit, frames } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    runtime.previous.mockImplementationOnce(async () => {
      // Turning back past the first slot relabels it: same window, slot 0, new key.
      frames.set(0, { ...frame(-1), spreadIndex: 0 });
      emit({ phase: 'ready', revisionId: 1, spreadIndex: 0, renderId: 9 } as ReaderSnapshot);
      return runtime.getSnapshot();
    });
    values.offset.value = -100;
    coordinator.step(-1);
    await vi.advanceTimersByTimeAsync(0);
    expect(values.offset.value).toBe(-100);
    expect(values.visibleTop.value).toBe(-800);
  });

  it('restarts the strip at a window it does not hold', async () => {
    const { coordinator, values, emit, frames } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    frames.set(7, frame(7, 800, 500));
    emit({ phase: 'ready', revisionId: 1, spreadIndex: 7, renderId: 70 } as ReaderSnapshot);
    expect(coordinator.getState().windows.map((window) => window.top)).toEqual([0]);
    expect(values.offset.value).toBe(500 - 48);
  });

  it('keeps the window it came from when the peek after a step skips that side', async () => {
    const { coordinator, runtime, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    runtime.peekAdjacentPages.mockImplementationOnce(async () => []);
    values.offset.value = 790;
    coordinator.step(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.getState().windows.map((window) => window.top)).toEqual([-800, 0, 800, 1600]);
  });

  it('names a scroll texture by what the window paints', () => {
    const content = (key: string, spread: number) => ({
      key,
      snapshot: { phase: 'ready', revisionId: 1, spreadIndex: spread, renderId: 1 } as ReaderSnapshot,
      picture: { picture: {} } as ReaderAdjacentPage['picture'],
      frame: frame(spread),
    });
    const relabelled = { ...content('1:0:9', 0), frame: { ...frame(0), renderKey: 'render-1' } };
    expect(nativeScrollTextureKey(relabelled, 'paint')).toBe(nativeScrollTextureKey(content('1:1:11', 1), 'paint'));
    expect(nativeScrollTextureKey(content('1:1:11', 1), 'paint')).not.toBe(
      nativeScrollTextureKey(content('1:2:12', 2), 'paint'),
    );
  });

  it('maps the view to the visible window only while the strip rests', async () => {
    const { coordinator, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.getTransform()?.toDisplayPoint(20, 48)).toEqual({ x: 20, y: 300 });
    coordinator.unsettle();
    expect(coordinator.getTransform()).toBeUndefined();
    values.offset.value = 100;
    coordinator.settle();
    expect(coordinator.getTransform()?.toViewportPoint(0, 300)).toEqual({ x: 0, y: 200 });
  });

  it('turns the runtime to a pressed window without moving the strip, and holds it there', async () => {
    const { coordinator, runtime, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    values.offset.value = 400;
    coordinator.settle();
    expect(coordinator.focusAt(10, 100)).toBe(true);
    const focused = coordinator.focusAt(10, 600);
    await vi.advanceTimersByTimeAsync(0);
    await expect(focused).resolves.toBe(true);
    expect(runtime.next).toHaveBeenCalledOnce();
    expect(values.offset.value).toBe(400);
    expect(values.holding.value).toBe(true);
    expect(coordinator.getTransform()?.toDisplayPoint(0, 600)).toEqual({ x: 0, y: 200 });
    // Held, the reading line's own window is not stepped back to.
    coordinator.step(-1);
    expect(runtime.previous).not.toHaveBeenCalled();
    coordinator.release();
    expect(values.holding.value).toBe(false);
  });

  it('records the line under the reading line once the strip rests', async () => {
    const { coordinator, runtime, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    values.offset.value = 100;
    coordinator.settle();
    expect(runtime.refineReadingPosition).toHaveBeenCalledWith(0, { x: 21, y: 148 });
  });

  it('finds the window and point a tap lands on', async () => {
    const { coordinator, values } = fixture();
    coordinator.attach();
    await vi.advanceTimersByTimeAsync(0);
    values.offset.value = 700;
    const hit = coordinator.hitAt(30, 150);
    expect(hit?.content.snapshot.spreadIndex).toBe(1);
    expect([hit?.x, hit?.y]).toEqual([30, 50]);
  });
});
