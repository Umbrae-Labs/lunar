import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderSnapshot } from '../../src/reader/contracts';
import type {
  LunarReaderRuntime,
  ReaderAdjacentPage,
  ReaderPreparedTurn,
} from '../../src/reader/runtime/core/native-reader-runtime';
import { ReaderPageTurnCoordinator } from '../../src/reader/skia/anime/controller/reader-page-turn-coordinator';
import { curlPageTurnEffect } from '../../src/reader/skia/anime/effects/curl/strategy';
import { slidePageTurnEffect } from '../../src/reader/skia/anime/effects/slide/strategy';
import type { PageTurnGestureValues } from '../../src/reader/skia/anime/gesture/use-page-turn-pan-gesture';
import {
  acknowledgeNativePagerPresentationById,
  cancelNativePagerGestureOnUI,
} from '../../src/reader/skia/anime/native/pager-compositor';

vi.mock('react-native-worklets', () => ({ runOnUI: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({
  acknowledgeNativePagerPresentationById: vi.fn(),
  cancelNativePagerGestureOnUI: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function page(index: number): ReaderSnapshot {
  return { phase: 'ready', revisionId: 1, spreadIndex: index, renderId: index + 100 } as ReaderSnapshot;
}

/** The neighbors of a page as the runtime's idle peek reports them. */
function neighbors(index: number): ReaderAdjacentPage[] {
  return (['next', 'previous'] as const).map((direction) => {
    const snapshot = page(index + (direction === 'next' ? 1 : -1));
    return {
      direction,
      snapshot,
      picture: { page: snapshot.spreadIndex },
      frame: { page: snapshot.spreadIndex, width: 400, height: 800 },
    } as unknown as ReaderAdjacentPage;
  });
}

function sharedValues(): PageTurnGestureValues {
  const shared = (value: unknown) => ({ value, set(next: unknown) { this.value = next; }, get() { return this.value; } });
  return Object.fromEntries([
    ['progress', 0], ['grabY', 0], ['heldRollTilt', 0], ['pressedEdgeX', 1], ['releasePending', false],
    ['nativeInputReady', false], ['nativePagerId', 0], ['nativeStockNextToken', 0], ['nativeStockPreviousToken', 0],
    ['inputBlocked', false],
  ].map(([key, value]) => [key, shared(value)])) as unknown as PageTurnGestureValues;
}

function fixture({ effect = slidePageTurnEffect } = {}) {
  let current = page(3);
  let preparationId = 0;
  let held: ReaderPreparedTurn | undefined;
  const listeners = new Set<(snapshot: ReaderSnapshot) => void>();
  const emit = (snapshot: ReaderSnapshot) => {
    current = snapshot;
    for (const listener of listeners) listener(snapshot);
  };
  const prepare = (direction: 'next' | 'previous'): ReaderPreparedTurn => {
    const step = direction === 'next' ? 1 : -1;
    held = {
      id: ++preparationId, revisionId: 1, direction,
      sourceSnapshotSpreadIndex: current.spreadIndex, sourcePreparedSpreadIndex: current.spreadIndex,
      targetSpreadIndex: current.spreadIndex + step, targetRenderId: current.renderId! + step,
    };
    return held;
  };
  const runtime = {
    getSnapshot: () => current,
    subscribe: (listener: (snapshot: ReaderSnapshot) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    suspendBackgroundPagination: vi.fn(() => () => undefined),
    getCurrentPicture: (_revision: number, index: number) => ({ page: index }),
    getCurrentFrame: (index: number) => ({ page: index, width: 400, height: 800 }),
    getPreparedTargetSnapshot: (turn: ReaderPreparedTurn) =>
      ({ ...current, spreadIndex: turn.targetSpreadIndex, renderId: turn.targetRenderId, bookSpreadIndex: turn.targetSpreadIndex }),
    canNavigate: vi.fn(() => true),
    prepareAdjacent: vi.fn(async (direction: 'next' | 'previous') => prepare(direction)),
    commitPreparedTurn: vi.fn(async (turn: ReaderPreparedTurn) => {
      held = undefined;
      emit({ ...current, spreadIndex: turn.targetSpreadIndex, renderId: turn.targetRenderId });
      return current;
    }),
    cancelPreparedTurn: vi.fn(async (turn: ReaderPreparedTurn) => { if (held?.id === turn.id) held = undefined; }),
    peekAdjacentPages: vi.fn(async (): Promise<readonly ReaderAdjacentPage[]> => []),
    next: vi.fn(async () => {
      emit({ ...current, spreadIndex: current.spreadIndex + 1, renderId: current.renderId! + 1 });
      return current;
    }),
    previous: vi.fn(async () => current),
  };
  const values = sharedValues();
  const coordinator = new ReaderPageTurnCoordinator(runtime as unknown as LunarReaderRuntime, values, {
    viewport: { width: 400, height: 800 }, pageTurnEffect: effect, spreadMode: 'single',
    animationDuration: 360, surfaceTop: 0,
  });
  coordinator.setSubscriberSnapshot(current);
  coordinator.attach();
  const state = () => coordinator.store.getState();
  async function drag(translationX = -150) {
    coordinator.beginDrag(350, 400);
    coordinator.updateDrag(translationX, 400, 4, 0);
    await vi.advanceTimersByTimeAsync(0);
  }
  const release = (sample = { throwVelocity: 4, throwAcceleration: 0, idleDecay: 1 }) =>
    coordinator.endDrag(-1600, -150, true, sample);
  const native = (token: number, prepared: number, event: 'consumed' | 'completed' | 'cancelled') =>
    coordinator.handleNativeEvent({ id: `lunar-interactive:${token}:${prepared}#turn:1`, event, direction: 1, eventAtMs: 0 });
  const render = (snapshot = current) => coordinator.setSubscriberSnapshot(snapshot);
  return { coordinator, runtime, values, state, drag, release, native, render, current: () => current };
}

describe('page turn coordinator handoff', () => {
  it('waits for the subscriber target before allowing another swipe, then preserves an older native tail', async () => {
    const { coordinator, runtime, state, drag, release, native, render, values } = fixture();
    await drag();
    expect(state().interactiveTurn?.source?.snapshot).toEqual(page(3));
    expect(state().interactiveTurn?.content?.key).toBe('1:4:104');
    const token = state().interactiveTurn!.nativeGesture!.token;
    coordinator.markNativeGestureAccepted(token);
    values.releasePending.set(true);
    release();
    expect(state().isSettling).toBe(true);
    native(token, 1, 'consumed');
    native(token, 1, 'consumed');
    await vi.advanceTimersByTimeAsync(0);
    render(page(3));
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
    expect(state().isSettling).toBe(true);
    expect(values.releasePending.value).toBe(true);
    render(page(4));
    expect(state().isSettling).toBe(false);
    expect(values.releasePending.value).toBe(false);

    await drag();
    expect(state().interactiveTurn?.source?.snapshot).toEqual(page(4));
    expect(state().interactiveTurn?.content?.key).toBe('1:5:105');
    const nextToken = state().interactiveTurn!.nativeGesture!.token;
    native(token, 1, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    expect(state().interactiveTurn?.nativeGesture?.token).toBe(nextToken);
    expect(acknowledgeNativePagerPresentationById).toHaveBeenCalledWith(0, 'lunar-interactive:1:1#turn:1');
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
  });

  it('rejects a gesture while the subscriber still shows an older page than the runtime', async () => {
    const { runtime, drag, render, state } = fixture();
    render(page(2));
    await drag();
    expect(runtime.prepareAdjacent).not.toHaveBeenCalled();
    expect(state().interactiveTurn).toBeUndefined();
    render(page(3));
    await drag();
    expect(state().interactiveTurn?.source?.snapshot).toEqual(page(3));
    expect(runtime.prepareAdjacent).toHaveBeenCalledOnce();
  });

  it('runs a tap made during a settling turn after the turn hands off', async () => {
    const { coordinator, runtime, state, drag, release, native, render } = fixture();
    await drag();
    const token = state().interactiveTurn!.nativeGesture!.token;
    coordinator.markNativeGestureAccepted(token);
    release();
    const tap = coordinator.next();
    expect(runtime.next).not.toHaveBeenCalled();
    native(token, 1, 'consumed');
    native(token, 1, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    render(page(4));
    await vi.advanceTimersByTimeAsync(40);
    await expect(tap).resolves.toMatchObject({ spreadIndex: 5 });
    expect(runtime.next).toHaveBeenCalledOnce();
  });

  it('leaves the page in place at either end of the book', async () => {
    const { runtime, state, drag } = fixture();
    runtime.canNavigate.mockReturnValue(false);
    await drag();
    expect(runtime.prepareAdjacent).not.toHaveBeenCalled();
    expect(state().interactiveTurn).toBeUndefined();
  });

  it('publishes an automatic turn in the same tick as its target snapshot', async () => {
    const { coordinator, runtime, state } = fixture({ effect: curlPageTurnEffect });
    let turnsAtEmit = -1;
    runtime.subscribe(() => { turnsAtEmit = state().automaticTurns.length; });
    const navigation = coordinator.next();
    await vi.advanceTimersByTimeAsync(0);
    await navigation;
    expect(turnsAtEmit).toBe(1);
    expect(state().automaticTurns[0]).toMatchObject({ direction: 1 });
  });

  it('stocks both neighbors while idle and keeps the pairs that did not change', async () => {
    const { runtime, state, values, coordinator } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    expect(runtime.peekAdjacentPages).toHaveBeenCalledWith(1, 3);
    const stocks = state().stocks;
    expect(stocks.map((stock) => [stock.direction, stock.preparedTurnId, stock.source.key, stock.target.key])).toEqual([
      [1, 0, '1:3:103', '1:4:104'],
      [-1, 0, '1:3:103', '1:2:102'],
    ]);
    coordinator.markStocked(stocks[0]!.token);
    coordinator.markStocked(stocks[1]!.token);
    expect(values.nativeStockNextToken.value).toBe(stocks[0]!.token);
    expect(values.nativeStockPreviousToken.value).toBe(stocks[1]!.token);
    expect(runtime.prepareAdjacent).not.toHaveBeenCalled();

    coordinator.configure({
      viewport: { width: 400, height: 800 }, pageTurnEffect: curlPageTurnEffect, spreadMode: 'single',
      animationDuration: 360, surfaceTop: 0,
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(state().stocks.map((stock) => stock.token)).toEqual(stocks.map((stock) => stock.token));
    expect(values.nativeStockNextToken.value).toBe(stocks[0]!.token);
  });

  it('lets the composer take a drag from an idle pair and commits once the turn is prepared', async () => {
    const { coordinator, runtime, state, values, release, native, render } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    const idle = state().stocks.find((stock) => stock.direction === 1)!;
    coordinator.markStocked(idle.token);

    // The runtime turn is still being prepared while the composer moves the sheet.
    let finishPreparation: () => void = () => undefined;
    const preparation = runtime.prepareAdjacent.getMockImplementation()!;
    runtime.prepareAdjacent.mockImplementationOnce(
      (direction) => new Promise((resolve) => { finishPreparation = () => resolve(preparation(direction)); }),
    );
    coordinator.beginDrag(350, 400);
    coordinator.updateDrag(-150, 400, 4, 0);
    coordinator.markNativeGestureAccepted(idle.token);
    expect(state().interactiveTurn?.nativeGesture).toMatchObject({
      token: idle.token, preparedTurnId: 0, targetKey: '1:4:104', driven: true,
    });
    expect(state().interactiveTurn?.content?.key).toBe('1:4:104');

    values.releasePending.set(true);
    release();
    native(idle.token, 0, 'consumed');
    native(idle.token, 0, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.commitPreparedTurn).not.toHaveBeenCalled();
    expect(state().stocks).toEqual([]);

    finishPreparation();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
    expect(runtime.commitPreparedTurn.mock.calls[0]![0]).toMatchObject({ targetSpreadIndex: 4, targetRenderId: 104 });
    expect(state().interactiveTurn?.nativeGesture?.preparedTurnId).toBe(1);
    render(page(4));
    await vi.advanceTimersByTimeAsync(40);
    expect(acknowledgeNativePagerPresentationById).toHaveBeenCalledWith(0, `lunar-interactive:${idle.token}:0#turn:1`);
    expect(state().interactiveTurn).toBeUndefined();
    expect(state().isSettling).toBe(false);
  });

  it('keeps serving a drag from its idle pair when the composer takes it after preparation', async () => {
    const { coordinator, runtime, state, values, drag } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    const stocks = state().stocks;
    const idle = stocks.find((stock) => stock.direction === 1)!;
    coordinator.markStocked(idle.token);
    await drag();
    expect(state().stocks).toBe(stocks);
    expect(values.nativeStockNextToken.value).toBe(idle.token);
    expect(state().interactiveTurn?.nativeGesture).toMatchObject({ token: idle.token, preparedTurnId: 1, driven: false });
    coordinator.markNativeGestureAccepted(idle.token);
    expect(state().interactiveTurn?.nativeGesture).toMatchObject({ token: idle.token, preparedTurnId: 1, driven: true });
  });

  it('follows a consumed idle pair with a plain turn when none could be prepared', async () => {
    const { coordinator, runtime, state, release, native, render } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    const idle = state().stocks.find((stock) => stock.direction === 1)!;
    coordinator.markStocked(idle.token);
    runtime.prepareAdjacent.mockImplementationOnce(async () => undefined as unknown as ReaderPreparedTurn);
    coordinator.beginDrag(350, 400);
    coordinator.updateDrag(-150, 400, 4, 0);
    coordinator.markNativeGestureAccepted(idle.token);
    release();
    native(idle.token, 0, 'consumed');
    native(idle.token, 0, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.commitPreparedTurn).not.toHaveBeenCalled();
    expect(runtime.next).toHaveBeenCalledOnce();
    render(page(4));
    await vi.advanceTimersByTimeAsync(40);
    expect(state().interactiveTurn).toBeUndefined();
  });

  it('hands back a sheet the composer took for a drag in the other direction', async () => {
    const { coordinator, runtime, state } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    const backward = state().stocks.find((stock) => stock.direction === -1)!;
    coordinator.beginDrag(350, 400);
    coordinator.updateDrag(-150, 400, 4, 0);
    coordinator.markNativeGestureAccepted(backward.token);
    expect(cancelNativePagerGestureOnUI).toHaveBeenCalledOnce();
    expect(state().interactiveTurn?.nativeGesture?.driven).not.toBe(true);
  });

  it('drops idle pairs once another page shows outside a drag', async () => {
    const { runtime, state, values, coordinator, render } = fixture({ effect: curlPageTurnEffect });
    runtime.peekAdjacentPages.mockImplementation(async () => neighbors(3));
    await vi.advanceTimersByTimeAsync(400);
    coordinator.markStocked(state().stocks[0]!.token);
    render(page(9));
    expect(state().stocks).toEqual([]);
    expect(values.nativeStockNextToken.value).toBe(0);
  });

  it('cancels the prepared target of a released swipe and clears its stocked pair', async () => {
    const { runtime, state, drag, coordinator } = fixture();
    await drag(-40);
    expect(state().stocks.find((stock) => stock.direction === 1)?.preparedTurnId).toBe(1);
    coordinator.endDrag(0, -40, false, { throwVelocity: 0, throwAcceleration: 0, idleDecay: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runtime.cancelPreparedTurn).toHaveBeenCalledOnce();
    expect(state().interactiveTurn).toBeUndefined();
    expect(state().stocks).toEqual([]);
  });
});
