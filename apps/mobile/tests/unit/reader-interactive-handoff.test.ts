import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderSnapshot } from '../../src/reader/contracts';
import type { LunarReaderRuntime } from '../../src/reader/runtime/core/native-reader-runtime';
import { useInteractivePageTurn } from '../../src/reader/skia/anime/controller/use-interactive-page-turn';
import { slidePageTurnEffect } from '../../src/reader/skia/anime/effects/slide/strategy';
import { acknowledgeNativePagerPresentationById } from '../../src/reader/skia/anime/native/pager-compositor';
import type { usePageTurnPanGesture, PageTurnGestureValues } from '../../src/reader/skia/anime/gesture/use-page-turn-pan-gesture';

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[],
  pan: undefined as unknown as Parameters<typeof usePageTurnPanGesture>[0],
  values: undefined as unknown as PageTurnGestureValues,
}));
vi.mock('react', () => ({
  useRef: (current: unknown) => {
    const index = hooks.cursor++;
    return hooks.slots[index] ?? (hooks.slots[index] = { current });
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: unknown) => {
      hooks.slots[index] = typeof update === 'function' ? update(hooks.slots[index]) : update;
    }];
  },
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    hooks.slots[index] = deps;
    if (deps && previous && deps.every((value, i) => Object.is(value, previous[i]))) return;
    hooks.effects.push(() => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); });
  },
}));
vi.mock('../../src/reader/skia/anime/gesture/use-page-turn-pan-gesture', () => ({
  usePageTurnGestureValues: () => hooks.values,
  usePageTurnPanGesture: (options: typeof hooks.pan) => { hooks.pan = options; return {}; },
}));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({
  acknowledgeNativePagerPresentationById: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); hooks.slots = []; hooks.cursor = 0;
  const shared = (value: unknown) => ({ value, set(next: unknown) { this.value = next; } });
  hooks.values = Object.fromEntries([
    'grabY', 'heldRollTilt', 'nativeInputReady', 'nativePagerId', 'nativeStockedToken',
    'pressedEdgeX', 'progress', 'releasePending',
  ].map((key) => [key, shared(key === 'releasePending' ? false : 0)])) as unknown as PageTurnGestureValues;
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  hooks.effects = []; vi.useRealTimers();
});

function page(index: number): ReaderSnapshot {
  return { phase: 'ready', revisionId: 1, spreadIndex: index, renderId: index + 100 } as ReaderSnapshot;
}
function fixture() {
  let current = page(3);
  let preparationId = 0;
  const runtime = {
    getSnapshot: () => current,
    getCurrentPicture: (_revision: number, index: number) => ({ page: index }),
    getCurrentFrame: (index: number) => ({ page: index, width: 400, height: 800 }),
    prepareAdjacent: vi.fn(async () => ({
      id: ++preparationId, revisionId: 1, sourceSnapshotSpreadIndex: current.spreadIndex,
      targetSpreadIndex: current.spreadIndex + 1, targetRenderId: current.renderId! + 1,
    })),
    commitPreparedTurn: vi.fn(async (prepared) => { current = page(prepared.targetSpreadIndex); return current; }),
    cancelPreparedTurn: vi.fn(async () => undefined),
    warmAdjacentPictures: vi.fn(async () => undefined),
  };
  function render(snapshot = current) {
    hooks.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- The fixture provides the mocked hook dispatcher.
    const result = useInteractivePageTurn({ runtime: runtime as unknown as LunarReaderRuntime,
      snapshot, viewport: { width: 400, height: 800 }, pageTurnEffect: slidePageTurnEffect,
      animationDuration: 360, spreadMode: 'single', automaticNavigationActive: false, surfaceTop: 0 });
    for (const effect of hooks.effects.splice(0)) effect();
    return result;
  }
  async function drag(token: number) {
    hooks.pan.beginDrag(350, 400, token);
    hooks.pan.updateDrag(-150, 400, -1600);
    await Promise.resolve();
    return render();
  }
  return { runtime, render, drag };
}

describe('interactive page handoff', () => {
  it('waits for the subscriber target before allowing another swipe, then preserves an older native tail', async () => {
    const { runtime, render, drag } = fixture();
    render();
    let controller = await drag(1);
    expect(controller.interactiveTurn?.source?.snapshot).toEqual(page(3));
    expect(controller.interactiveTurn?.content?.key).toBe('1:4:104');
    hooks.pan.markNativeGestureAccepted(1);
    render();
    hooks.values.releasePending.set(true);
    hooks.pan.endDrag(-1600, -150, true);
    controller = render();
    expect(controller.isSettling).toBe(true);
    const event = { id: 'lunar-interactive:1:1#turn:1', event: 'consumed' as const,
      direction: 1 as const, eventAtMs: 0 };
    controller.surfaceBinding.onNativeEvent(event);
    controller.surfaceBinding.onNativeEvent(event);
    controller = render(page(3));
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
    expect(controller.isSettling).toBe(true);
    expect(hooks.values.releasePending.value).toBe(true);
    controller = render(page(4));
    expect(controller.isSettling).toBe(false);
    expect(hooks.values.releasePending.value).toBe(false);
    controller = await drag(2);
    expect(controller.interactiveTurn?.source?.snapshot).toEqual(page(4));
    expect(controller.interactiveTurn?.content?.key).toBe('1:5:105');
    controller.surfaceBinding.onNativeEvent({ ...event, event: 'completed' });
    await Promise.resolve();
    controller = render();
    expect(controller.interactiveTurn?.nativeGesture?.token).toBe(2);
    expect(acknowledgeNativePagerPresentationById).toHaveBeenCalledWith(0, event.id);
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
  });

  it('rejects a gesture while a final tap snapshot is still waiting for its subscriber', async () => {
    const { runtime, render } = fixture();
    render(page(2));
    hooks.pan.beginDrag(350, 400, 1);
    hooks.pan.updateDrag(-150, 400, -1600);
    await Promise.resolve();
    expect(runtime.prepareAdjacent).not.toHaveBeenCalled();
    hooks.values.releasePending.set(true);
    hooks.pan.endDrag(-1600, -150, false);
    expect(hooks.values.releasePending.value).toBe(false);
    render(page(3));
    hooks.pan.beginDrag(350, 400, 2);
    hooks.pan.updateDrag(-150, 400, -1600);
    await Promise.resolve();
    const controller = render();
    expect(controller.interactiveTurn?.source?.snapshot).toEqual(page(3));
    expect(runtime.prepareAdjacent).toHaveBeenCalledOnce();
  });
});
