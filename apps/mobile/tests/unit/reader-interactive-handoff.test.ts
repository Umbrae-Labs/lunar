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
import { cancelNativePagerGestureOnUI } from '../../src/reader/skia/anime/native/pager-compositor';

vi.mock('react-native-worklets', () => ({ runOnUI: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({
  cancelNativePagerGestureOnUI: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

function page(index: number): ReaderSnapshot {
  return { phase: 'ready', revisionId: 1, spreadIndex: index, renderId: index + 100 } as ReaderSnapshot;
}

function key(index: number): string {
  return `1:${index}:${index + 100}`;
}

/** The spreads around a page as the runtime's peek reports them, `depth` turns each way. */
function neighbors(index: number, depth = 1): ReaderAdjacentPage[] {
  return (['next', 'previous'] as const).flatMap((direction) =>
    Array.from({ length: depth }, (_, step) => {
      const distance = step + 1;
      const snapshot = page(index + (direction === 'next' ? distance : -distance));
      return {
        direction,
        distance,
        snapshot,
        picture: { page: snapshot.spreadIndex },
        frame: { page: snapshot.spreadIndex, width: 400, height: 800 },
      } as unknown as ReaderAdjacentPage;
    }),
  );
}

function sharedValues(): PageTurnGestureValues {
  const shared = (value: unknown) => ({ value, set(next: unknown) { this.value = next; }, get() { return this.value; } });
  return Object.fromEntries([
    ['progress', 0], ['releasePending', false],
    ['nativeInputReady', false], ['nativePagerId', 0], ['nativeStockNextToken', 0], ['nativeStockPreviousToken', 0],
    ['inputBlocked', false], ['nativeTapEnabled', false], ['nativeTapBlockers', []], ['nativeTapLead', false],
    ['nativeTapSerial', 0], ['nativeTapAtMs', 0],
  ].map(([name, value]) => [name, shared(value)])) as unknown as PageTurnGestureValues;
}

function fixture({ effect = slidePageTurnEffect } = {}) {
  let current = page(3);
  let preparationId = 0;
  const listeners = new Set<(snapshot: ReaderSnapshot) => void>();
  const emit = (snapshot: ReaderSnapshot) => {
    current = snapshot;
    for (const listener of listeners) listener(snapshot);
  };
  const runtime = {
    getSnapshot: () => current,
    subscribe: (listener: (snapshot: ReaderSnapshot) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    suspendBackgroundPagination: vi.fn(() => () => undefined),
    getCurrentPicture: (_revision: number, index: number) => ({ page: index }),
    getCurrentFrame: (index: number) => ({ page: index, width: 400, height: 800 }),
    getPreparedTargetSnapshot: (turn: ReaderPreparedTurn) =>
      ({ ...current, spreadIndex: turn.targetSpreadIndex, renderId: turn.targetRenderId }),
    canNavigate: vi.fn(() => true),
    prepareAdjacent: vi.fn(async (direction: 'next' | 'previous'): Promise<ReaderPreparedTurn> => {
      const step = direction === 'next' ? 1 : -1;
      return {
        id: ++preparationId, revisionId: 1, direction,
        sourceSnapshotSpreadIndex: current.spreadIndex, sourcePreparedSpreadIndex: current.spreadIndex,
        targetSpreadIndex: current.spreadIndex + step, targetRenderId: current.renderId! + step,
      } as ReaderPreparedTurn;
    }),
    commitPreparedTurn: vi.fn(async (turn: ReaderPreparedTurn) => {
      emit({ ...current, spreadIndex: turn.targetSpreadIndex, renderId: turn.targetRenderId });
      return current;
    }),
    cancelPreparedTurn: vi.fn(async () => undefined),
    peekAdjacentPages: vi.fn(async (): Promise<readonly ReaderAdjacentPage[]> => []),
    next: vi.fn(async () => {
      emit(page(current.spreadIndex + 1));
      return current;
    }),
    previous: vi.fn(async () => {
      emit(page(current.spreadIndex - 1));
      return current;
    }),
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
  /** The stock token the composer holds for a turn this way from the shown page. */
  const stockToken = (direction: 1 | -1, distance = 1) =>
    state().stocks.find((stock) => stock.direction === direction && stock.distance === distance)!.token;
  const release = (nativeReleased: boolean) =>
    coordinator.endDrag(-1600, -150, nativeReleased, { throwVelocity: 4, throwAcceleration: 0, idleDecay: 1 });
  const native = (token: number, prepared: number, event: 'consumed' | 'completed' | 'cancelled', turn = 1) =>
    coordinator.handleNativeEvent({ id: `lunar-interactive:${token}:${prepared}#turn:${turn}`, event, direction: 1, eventAtMs: 0 });
  const render = (snapshot = current) => coordinator.setSubscriberSnapshot(snapshot);
  /** Lets the idle peek stock the pages around the shown one. */
  async function stockAround(index: number, depth = 1) {
    runtime.peekAdjacentPages.mockResolvedValueOnce(neighbors(index, depth));
    await vi.advanceTimersByTimeAsync(400);
    for (const stock of state().stocks) coordinator.markStocked(stock.token);
  }
  return { coordinator, runtime, values, state, drag, release, native, render, stockToken, stockAround, emit, current: () => current };
}

describe('page turn coordinator: drags', () => {
  it('commits the turn a composer sheet consumed once, and ends it on completion', async () => {
    const { coordinator, runtime, state, drag, release, native, render, stockToken, values } = fixture();
    await drag();
    const token = stockToken(1);
    expect(state().stocks[0]!.target.key).toBe(key(4));
    coordinator.markStocked(token);
    expect(values.nativeStockNextToken.value).toBe(token);
    coordinator.markNativeGestureAccepted(token);
    expect(state().nativeGestureDriven).toBe(true);
    expect(state().composerEventsActive).toBe(true);
    release(true);
    expect(state().isSettling).toBe(true);
    native(token, 1, 'consumed');
    native(token, 1, 'consumed');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
    // The composer already shows the page it turned to: the surface presents it without a turn.
    expect(coordinator.takeTurnIntent(key(4))).toBe(0);
    render(page(4));
    native(token, 1, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    expect(state().isSettling).toBe(false);
    expect(state().turning).toBe(false);
    expect(values.releasePending.value).toBe(false);
  });

  it('turns to a committed target through the composer when the drag ended before the composer took it', async () => {
    const { coordinator, runtime, state, drag, release } = fixture();
    await drag();
    release(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.commitPreparedTurn).toHaveBeenCalledOnce();
    expect(state().isSettling).toBe(false);
    expect(coordinator.takeTurnIntent(key(4))).toBe(1);
    expect(coordinator.takeTurnIntent(key(4))).toBe(0);
  });

  it('cancels a drag released short of the commit without moving the page', async () => {
    const { coordinator, runtime, state, drag } = fixture({ effect: curlPageTurnEffect });
    await drag(-20);
    coordinator.endDrag(0, -20, false, { throwVelocity: 0, throwAcceleration: 0, idleDecay: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.cancelPreparedTurn).toHaveBeenCalledOnce();
    expect(runtime.commitPreparedTurn).not.toHaveBeenCalled();
    expect(state().isSettling).toBe(false);
    expect(coordinator.takeTurnIntent(key(4))).toBe(0);
  });

  it('cancels the prepared turn when the composer reverts its sheet', async () => {
    const { coordinator, runtime, state, drag, release, native, stockToken } = fixture();
    await drag();
    const token = stockToken(1);
    coordinator.markNativeGestureAccepted(token);
    release(true);
    native(token, 1, 'cancelled');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.cancelPreparedTurn).toHaveBeenCalledOnce();
    expect(runtime.commitPreparedTurn).not.toHaveBeenCalled();
    expect(state().isSettling).toBe(false);
  });

  it('rejects a drag while the subscriber still shows an older page than the runtime', async () => {
    const { coordinator, state, emit } = fixture();
    emit(page(4));
    coordinator.beginDrag(350, 400);
    expect(state().turning).toBe(false);
  });

  it('hands back a sheet the composer took for a drag RN no longer owns', () => {
    const { coordinator } = fixture();
    coordinator.markNativeGestureAccepted(9);
    expect(cancelNativePagerGestureOnUI).toHaveBeenCalledOnce();
  });

  it('runs a tap made during a released drag once its turn ends', async () => {
    const { coordinator, runtime, drag, release, native, render, stockToken } = fixture();
    await drag();
    const token = stockToken(1);
    coordinator.markNativeGestureAccepted(token);
    release(true);
    const tap = coordinator.next();
    expect(runtime.next).not.toHaveBeenCalled();
    native(token, 1, 'consumed');
    await vi.advanceTimersByTimeAsync(0);
    render(page(4));
    native(token, 1, 'completed');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.next).toHaveBeenCalledOnce();
    await expect(tap).resolves.toEqual(page(5));
    expect(coordinator.takeTurnIntent(key(5))).toBe(1);
  });

  it('forces the composer back onto the runtime page when it consumed a pair nobody commits', () => {
    const { state, native } = fixture();
    native(77, 0, 'consumed');
    expect(state().presentEpoch).toBe(1);
  });
});

describe('page turn coordinator: RN navigation', () => {
  it('announces each page the runtime publishes as turned to, in its direction', async () => {
    const { coordinator, state } = fixture();
    const forward = coordinator.next();
    expect(state().automaticNavigationActive).toBe(true);
    await expect(forward).resolves.toEqual(page(4));
    expect(state().automaticNavigationActive).toBe(false);
    expect(coordinator.takeTurnIntent(key(4))).toBe(1);
    await coordinator.previous();
    expect(coordinator.takeTurnIntent(key(3))).toBe(-1);
  });

  it('drops the turns of pages the subscriber skipped', async () => {
    const { coordinator } = fixture();
    await coordinator.next();
    await coordinator.next();
    expect(coordinator.takeTurnIntent(key(5))).toBe(1);
    // A later jump back to the skipped page must not replay its turn.
    expect(coordinator.takeTurnIntent(key(4))).toBe(0);
  });

  it('keeps native taps off while RN navigation moves the runtime', async () => {
    const { coordinator, values, render } = fixture();
    coordinator.setTapGuard(true, []);
    expect(values.nativeTapEnabled.value).toBe(true);
    const forward = coordinator.next();
    expect(values.nativeTapEnabled.value).toBe(false);
    await forward;
    // The runtime landed, but the subscriber still shows the page it left.
    expect(values.nativeTapEnabled.value).toBe(false);
    render(page(4));
    expect(values.nativeTapEnabled.value).toBe(true);
  });
});

describe('page turn coordinator: taps the composer turns ahead of the runtime', () => {
  it('stocks a chain of pairs around the shown page for taps', async () => {
    const { state, stockAround, values } = fixture();
    await stockAround(3, 2);
    expect(state().stocks.map((stock) => [stock.source.key, stock.target.key])).toEqual([
      [key(3), key(4)],
      [key(4), key(5)],
      [key(3), key(2)],
      [key(2), key(1)],
    ]);
    expect(values.nativeStockNextToken.value).toBe(state().stocks[0]!.token);
  });

  it('follows two taps the composer took, one page each, in order', async () => {
    const { coordinator, runtime, state, native, stockAround, stockToken } = fixture();
    await stockAround(3, 2);
    native(stockToken(1, 1), 0, 'consumed', 1);
    native(stockToken(1, 2), 0, 'consumed', 2);
    expect(state().automaticNavigationActive).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.next).toHaveBeenCalledTimes(2);
    expect(state().automaticNavigationActive).toBe(false);
    // The composer leads: the pages the runtime publishes are not turned to again.
    expect(coordinator.takeTurnIntent(key(4))).toBe(0);
    expect(coordinator.takeTurnIntent(key(5))).toBe(0);
    expect(state().presentEpoch).toBe(0);
  });

  it('does not move a runtime that already shows the page the composer turned to', async () => {
    const { runtime, native, stockAround, stockToken, emit } = fixture();
    await stockAround(3);
    const token = stockToken(1);
    emit(page(4));
    native(token, 0, 'consumed');
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.next).not.toHaveBeenCalled();
  });

  it('shows the runtime page again when the runtime cannot follow the composer', async () => {
    const { runtime, state, native, stockAround, stockToken, current } = fixture();
    await stockAround(3);
    runtime.next.mockImplementationOnce(async () => current());
    native(stockToken(1), 0, 'consumed');
    await vi.advanceTimersByTimeAsync(0);
    expect(state().presentEpoch).toBe(1);
    expect(state().automaticNavigationActive).toBe(false);
  });

  it('turns once for each tap RN received while the runtime followed the composer', async () => {
    const { coordinator, runtime, native, stockAround, stockToken, render } = fixture();
    await stockAround(3);
    let resolveFollow: () => void = () => undefined;
    runtime.next.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFollow = () => resolve(page(4));
      }),
    );
    native(stockToken(1), 0, 'consumed');
    const first = coordinator.next();
    const second = coordinator.next();
    expect(runtime.next).toHaveBeenCalledOnce();
    resolveFollow();
    await vi.advanceTimersByTimeAsync(0);
    render(page(4));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
    expect(runtime.next).toHaveBeenCalledTimes(3);
  });

  it('reads composer events from a tap the UI thread reports until the window passes', async () => {
    const { coordinator, state } = fixture();
    expect(state().composerEventsActive).toBe(false);
    coordinator.noteNativeTap();
    expect(state().composerEventsActive).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(state().composerEventsActive).toBe(false);
  });
});
