import { runOnUI } from 'react-native-worklets';

import type { ReaderSnapshot, ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type {
  LunarReaderRuntime,
  ReaderAdjacentPage,
  ReaderPreparedTurn,
  ReaderTurnDirection,
} from '../../../runtime/core/native-reader-runtime';
import { readerDiagnostic, readerPerformanceId, readerPerformanceMark } from '../../../runtime/core/performance';
import {
  describePreparedTarget,
  describeSnapshotIdentity,
  formatTraceNumber,
  readerPageContentForSnapshot,
  sameSnapshotIdentity,
} from '../core/page-content';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderPageContent } from '../core/page-turn-types';
import {
  pageTurnLeaf,
  planarTurnProgressForTranslation,
  type PageTurnReleaseSample,
} from '../gesture/page-turn-gesture';
import type { PageTurnGestureValues } from '../gesture/use-page-turn-pan-gesture';
import { readerInteractivePageTurnIdentity } from '../native/page-turn';
import { cancelNativePagerGestureOnUI, type NativePagerEventRecord } from '../native/pager-compositor';
import type { ReaderDragState, ReaderNativeCommit, ReaderNativeGestureHandoff } from './interactive-page-turn-state';
import { ReaderPageTurnStore, type ReaderPageTurnState, type ReaderPageTurnStock } from './page-turn-store';

export interface ReaderPageTurnConfig {
  readonly viewport?: ReaderViewport;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly spreadMode: ReaderSpreadMode;
  readonly animationDuration: number;
  /** Vertical viewport offset of the reader surface, used with absolute gesture coordinates. */
  readonly surfaceTop: number;
}

/** Idle time before neighboring pictures are compiled. */
const WARM_DELAY_MS = 350;
/** How long after a native tap the press RN receives for it is still that tap's. */
const NATIVE_TAP_CLAIM_MS = 700;
/** How many stocked pairs are remembered for late composer events. */
const STOCK_LEDGER_SIZE = 64;
/** How many announced turns wait for the surface at most. */
const TURN_INTENT_LIMIT = 32;

interface DeferredTap {
  direction: 1 | -1;
  /** Taps the same way since the first, each one page; a tap the other way starts over. */
  count: number;
  readonly resolvers: ((snapshot: ReaderSnapshot) => void)[];
}

/** A turn the composer made on a tap that the runtime has yet to make. */
interface NativeTapFollow {
  readonly direction: 1 | -1;
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly performanceId?: string;
}

/**
 * Owns every page turn of one reader runtime: finger drags, taps and RN
 * navigation. The native composer presents every page and animates every
 * turn; this controller keeps the runtime on the page the composer shows and
 * tells the surface how each page the runtime publishes is reached. It is a
 * plain object so that turn bookkeeping never re-renders the reader screen.
 */
export class ReaderPageTurnCoordinator {
  readonly store = new ReaderPageTurnStore();
  private config: ReaderPageTurnConfig;
  private subscriberSnapshot: ReaderSnapshot;
  private disposed = false;
  private readonly detachments: (() => void)[] = [];
  private backgroundSuspension?: () => void;

  // Input turns.
  private drag?: ReaderDragState;
  private turnSequence = 0;
  /** The drag being turned, from its first move until its runtime turn ends. */
  private activeTurnId?: number;
  private readonly nativeHandoffs = new Map<number, ReaderNativeGestureHandoff>();
  private nativeGestureDriven = false;
  private stockTokenSequence = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private refillTimer?: ReturnType<typeof setTimeout>;
  /** The page whose neighbors were last peeked in full. */
  private peekedKey?: string;
  /** The way the reader last turned; its neighbor that way is peeked first. */
  private travelDirection: 1 | -1 = 1;
  private deferredTap?: DeferredTap;

  // RN navigation.
  private navigationQueue: Promise<void> = Promise.resolve();
  private navigationGeneration = 0;
  private pendingNavigations = 0;
  /** The direction of the navigation running now; pages it publishes are turned to. */
  private navigationDirection?: 1 | -1;
  /** How the surface reaches pages the runtime publishes, by page key. */
  private readonly turnIntents = new Map<string, 1 | -1>();

  // Taps the composer turned by itself, ahead of the runtime.
  private readonly stockLedger = new Map<number, ReaderPageTurnStock>();
  /** Turns the runtime has yet to follow, oldest first. */
  private readonly nativeFollows: NativeTapFollow[] = [];
  private following = false;
  /** Tap sheets the composer still animates, by native turn id. */
  private readonly nativeTapSheets = new Set<string>();
  private claimedNativeTaps = 0;
  private nativeTapWatchTimer?: ReturnType<typeof setTimeout>;
  private tapGuardEnabled = false;

  constructor(
    readonly runtime: LunarReaderRuntime,
    private readonly values: PageTurnGestureValues,
    config: ReaderPageTurnConfig,
  ) {
    this.config = config;
    this.subscriberSnapshot = runtime.getSnapshot();
  }

  /** Starts listening to the runtime; the returned function disposes the controller. */
  attach(): () => void {
    this.disposed = false;
    this.detachments.push(this.runtime.subscribe(this.handleRuntimeSnapshot));
    this.clearStockTokens();
    this.scheduleIdleWork();
    return () => this.dispose();
  }

  configure(config: ReaderPageTurnConfig): void {
    this.config = config;
    this.scheduleIdleWork();
  }

  /** The snapshot the subscriber renders. */
  setSubscriberSnapshot(snapshot: ReaderSnapshot): void {
    if (snapshot === this.subscriberSnapshot) return;
    this.subscriberSnapshot = snapshot;
    const stocks = this.store.getState().stocks;
    // Pairs stocked at idle leave the page they were stocked on. Once another
    // page shows outside a drag (a tap, a jump), no drag can start from them.
    const shown = describeSnapshotIdentity(snapshot);
    const staleStocks = !this.drag && this.activeTurnId === undefined && stocks.some((stock) => stock.around !== shown);
    if (staleStocks) this.clearStockTokens();
    this.publish(staleStocks ? { stocks: [] } : {});
    if (this.deferredTap) this.runDeferredTap();
    this.scheduleRefill();
    this.scheduleIdleWork();
  }

  /** How the surface reaches the page with this key; see `ReaderPageTurnSurfaceBinding`. */
  readonly takeTurnIntent = (pageKey: string): 1 | -1 | 0 => {
    const direction = this.turnIntents.get(pageKey);
    if (direction === undefined) return 0;
    // Pages announced before this one were skipped by the subscriber: a later
    // jump to one of them must not replay its turn.
    for (const key of this.turnIntents.keys()) {
      this.turnIntents.delete(key);
      if (key === pageKey) break;
    }
    return direction;
  };

  // Input from the pan gesture. Each callback is a stable property so the
  // gesture never has to be rebuilt.

  readonly beginDrag = (startX: number, startY: number): void => {
    const { viewport, pageTurnEffect } = this.config;
    const snapshot = this.subscriberSnapshot;
    const state = this.store.getState();
    if (snapshot.phase !== 'ready' || !viewport || state.isSettling || state.automaticNavigationActive) return;
    if (!sameSnapshotIdentity(snapshot, this.runtime.getSnapshot())) return;
    const source = readerPageContentForSnapshot(this.runtime, snapshot);
    if (!source) return;
    this.clearIdleTimer();
    const turnId = ++this.turnSequence;
    this.activeTurnId = turnId;
    this.drag = {
      performanceId: readerPerformanceId('gesture'),
      id: turnId,
      nativeGestureToken: 0,
      revisionId: snapshot.revisionId,
      startSpread: snapshot.spreadIndex,
      startX,
      source,
      direction: 1,
      directionLocked: false,
      startBookX: 1,
      physicalProgress: 0,
      renderProgress: 0,
      fingerX: 1,
      throwVelocity: 0,
      throwAcceleration: 0,
      preparing: false,
      prepared: false,
    };
    readerPerformanceMark('reader.gesture.begin', {
      workId: this.drag.performanceId,
      turnId,
      effect: pageTurnEffect.visual.kind,
    });
    readerDiagnostic(
      'turn.gesture.begin',
      () =>
        `turn=${turnId} source=${describeSnapshotIdentity(snapshot)} x=${formatTraceNumber(startX)} y=${formatTraceNumber(startY)}`,
    );
    this.publish({});
  };

  readonly updateDrag = (
    translationX: number,
    _absoluteY: number,
    throwVelocity: number,
    throwAcceleration: number,
  ): void => {
    const state = this.drag;
    const { viewport, pageTurnEffect, spreadMode } = this.config;
    if (!state || !viewport || this.subscriberSnapshot.phase !== 'ready') return;
    if (!state.directionLocked) {
      if (Math.abs(translationX) < 2) return;
      state.direction = translationX < 0 ? 1 : -1;
      state.directionLocked = true;
      readerDiagnostic(
        'turn.gesture.direction',
        () =>
          `turn=${state.id} direction=${directionName(state.direction)} translationX=${formatTraceNumber(translationX)}`,
      );
      // At either end of the book there is nothing to reveal; the page stays
      // put instead of sliding over blank paper and snapping back.
      if (!this.runtime.canNavigate(directionName(state.direction))) {
        readerDiagnostic('turn.gesture.edge', () => `turn=${state.id} direction=${directionName(state.direction)}`);
        this.drag = undefined;
        this.activeTurnId = undefined;
        this.publish({});
        return;
      }
    }

    const direction = state.direction;
    const leaf = pageTurnLeaf(pageTurnEffect.visual.kind, spreadMode, viewport.width, direction);
    state.startBookX = pageTurnEffect.gesture.getStartBookX(state.startX - leaf.offset, direction, leaf.width);
    const geometry = pageTurnEffect.gesture.getGeometry({
      startBookX: state.startBookX,
      translationX,
      direction,
      pageWidth: leaf.width,
    });
    state.fingerX = geometry.fingerX;
    state.physicalProgress = planarTurnProgressForTranslation(translationX, direction, leaf.width);
    state.renderProgress = pageTurnEffect.gesture.renderProgress({
      physicalProgress: state.physicalProgress,
      direction,
      spreadMode,
    });
    // The pan gesture tracks the throw on the UI runtime at every sample;
    // this side only sees some of them, so it adopts that track as is.
    state.throwAcceleration = throwAcceleration;
    state.throwVelocity = throwVelocity;

    if (state.preparedTurn && !state.prepared) {
      this.showPreparedTurn(state, state.preparedTurn);
      return;
    }
    if (state.preparing || state.prepared) return;
    this.prepareDragTarget(state);
  };

  /**
   * The composer took the drag from the pair stocked under `stockToken`. A
   * pair stocked at idle is taken before the drag's runtime turn exists: the
   * drag keeps preparing it, and the sheet's terminal events wait for it.
   */
  readonly markNativeGestureAccepted = (stockToken: number): void => {
    const state = this.drag;
    const stock = this.store.getState().stocks.find((candidate) => candidate.token === stockToken);
    if (
      !state ||
      !state.directionLocked ||
      !stock ||
      stock.direction !== state.direction ||
      stock.source.key !== state.source.key
    ) {
      // The composer took a drag RN no longer owns. Hand the sheet back.
      readerDiagnostic('turn.native.orphan', () => `stock=${stockToken} turn=${state?.id ?? 'none'}`);
      const nativeId = this.values.nativePagerId.value;
      runOnUI((id: number) => {
        'worklet';
        cancelNativePagerGestureOnUI(id);
      })(nativeId);
      return;
    }
    state.nativeGestureToken = stockToken;
    state.nativeAccepted = true;
    this.nativeGestureDriven = true;
    if (!state.preparation && !state.preparedTurn && !state.preparing) this.prepareDragTarget(state);
    if (!this.nativeHandoffs.has(stockToken)) {
      this.nativeHandoffs.set(stockToken, {
        turnId: state.id,
        gestureToken: stockToken,
        direction: state.direction,
        preparation: this.preparationOf(state),
        preparedTurn: state.preparedTurn,
        terminalEventHandled: false,
      });
    }
    readerPerformanceMark('reader.native.accepted', {
      workId: state.performanceId,
      turnId: state.id,
      stock: stockToken,
      prepared: state.preparedTurn?.id ?? 0,
    });
    this.publish({});
  };

  readonly endDrag = (
    releaseVelocity = 0,
    releaseTranslationX = 0,
    nativeReleased = false,
    release?: PageTurnReleaseSample,
  ): void => {
    const state = this.drag;
    if (!state) {
      this.values.releasePending.set(false);
      return;
    }
    if (state.preparation && !state.preparedTurn && !nativeReleased) {
      readerPerformanceMark('reader.gesture.wait-prepare', { workId: state.performanceId });
      void state.preparation.then(() => {
        if (this.drag === state) this.finishDrag(state, releaseVelocity, releaseTranslationX, nativeReleased, release);
      });
      return;
    }
    this.finishDrag(state, releaseVelocity, releaseTranslationX, nativeReleased, release);
  };

  readonly handleNativeEvent = (event: NativePagerEventRecord): void => {
    const identity = readerInteractivePageTurnIdentity(event.id);
    if (!identity) return;
    const handoff = this.nativeHandoffs.get(identity.gestureToken);
    if (!handoff && this.handleNativeTapEvent(event, identity.gestureToken)) return;
    const preparedId = handoff?.preparedTurn?.id;
    if (
      !handoff ||
      (identity.preparedTurnId > 0 && preparedId !== undefined && preparedId !== identity.preparedTurnId)
    ) {
      if (event.event === 'consumed') {
        // The composer advanced past a pair nobody will commit: show the
        // runtime's page again rather than letting it drift.
        readerDiagnostic('turn.native.unowned', () => `native=${event.id}`);
        this.forcePresent();
      }
      return;
    }
    readerDiagnostic(
      'turn.native.event',
      () =>
        `turn=${identity.gestureToken} prepared=${handoff.preparedTurn?.id ?? 'pending'} event=${event.event} native=${event.id}`,
    );
    if (event.event === 'consumed' && !handoff.commit) {
      // The composer now rests on the target: every pair left the old page.
      this.travelDirection = handoff.direction;
      this.nativeGestureDriven = false;
      this.clearStockTokens();
      this.publish({ stocks: [] });
      handoff.commit = this.commitNativeHandoff(handoff);
      return;
    }
    if (handoff.terminalEventHandled || (event.event !== 'completed' && event.event !== 'cancelled')) return;
    handoff.terminalEventHandled = true;
    this.nativeGestureDriven = false;
    if (event.event === 'cancelled') {
      void handoff.preparation
        .then((preparedTurn) => (preparedTurn ? this.runtime.cancelPreparedTurn(preparedTurn) : undefined))
        .catch(() => undefined)
        .then(() => this.endNativeHandoff(identity.gestureToken, handoff));
      return;
    }
    const commit = handoff.commit ?? this.commitNativeHandoff(handoff);
    handoff.commit = commit;
    void commit
      .then(
        ({ snapshot }) => {
          readerDiagnostic(
            'turn.native.committed',
            () => `turn=${handoff.turnId} runtime=${describeSnapshotIdentity(snapshot)}`,
          );
        },
        () => {
          // The runtime could not follow the sheet: show its page again.
          this.forcePresent();
        },
      )
      .then(() => this.endNativeHandoff(identity.gestureToken, handoff));
  };

  /** Reports that the composer now holds the pair stocked under this token. */
  readonly markStocked = (token: number): void => {
    const stock = this.store.getState().stocks.find((candidate) => candidate.token === token);
    if (!stock || this.nativeHandoffs.has(token)) return;
    // Pairs further out wait in the composer for a tap; a drag starts from the page shown.
    if (stock.distance === 1 && stock.around === describeSnapshotIdentity(this.subscriberSnapshot)) {
      this.stockTokenFor(stock.direction).set(token);
    }
    readerPerformanceMark('reader.native.stocked', {
      workId: stock.performanceId,
      stock: token,
      direction: stock.direction,
      idle: stock.preparedTurnId === 0,
    });
  };

  /** The composer was reset and dropped every stocked pair. */
  readonly markStockLost = (): void => {
    this.clearStockTokens();
  };

  // Tap and programmatic navigation.

  readonly next = (): Promise<ReaderSnapshot> => this.navigate(1);
  readonly previous = (): Promise<ReaderSnapshot> => this.navigate(-1);

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const detach of this.detachments.splice(0)) detach();
    this.clearIdleTimer();
    if (this.refillTimer !== undefined) clearTimeout(this.refillTimer);
    this.refillTimer = undefined;
    this.navigationGeneration += 1;
    this.navigationDirection = undefined;
    this.turnIntents.clear();
    this.nativeHandoffs.clear();
    this.nativeGestureDriven = false;
    this.values.nativeInputReady.set(false);
    this.clearStockTokens();
    this.values.releasePending.set(false);
    const preparedTurn = this.drag?.preparedTurn;
    this.drag = undefined;
    if (preparedTurn) void this.runtime.cancelPreparedTurn(preparedTurn);
    this.backgroundSuspension?.();
    this.backgroundSuspension = undefined;
    for (const resolve of this.deferredTap?.resolvers ?? []) resolve(this.runtime.getSnapshot());
    this.deferredTap = undefined;
    this.nativeFollows.length = 0;
    this.nativeTapSheets.clear();
    if (this.nativeTapWatchTimer !== undefined) clearTimeout(this.nativeTapWatchTimer);
    this.nativeTapWatchTimer = undefined;
    this.values.nativeTapEnabled.set(false);
  }

  // Taps the composer turned by itself.

  /**
   * Whether the composer already turned the page for this press on the UI
   * thread. Each native tap claims one press, so RN does not turn it again.
   */
  readonly claimNativeTap = (): boolean => {
    const serial = this.values.nativeTapSerial.value;
    if (serial <= this.claimedNativeTaps) return false;
    if (Date.now() - this.values.nativeTapAtMs.value > NATIVE_TAP_CLAIM_MS) {
      // Presses that never reached RN cannot claim later ones.
      this.claimedNativeTaps = serial;
      return false;
    }
    this.claimedNativeTaps += 1;
    return true;
  };

  /**
   * What a tap on the UI thread must leave to RN: whether a tap in a turn
   * zone may turn the page natively at all, and the regions (x, y, width,
   * height in view coordinates, flattened) where a tap means something else.
   */
  readonly setTapGuard = (enabled: boolean, blockers: readonly number[]): void => {
    this.tapGuardEnabled = enabled;
    this.values.nativeTapBlockers.set(blockers);
    this.publish({});
  };

  /**
   * The UI thread turned a page on a tap in the composer. Its `consumed`
   * event is read once events are polled; until then nothing else polls them,
   * and the runtime would never follow.
   */
  readonly noteNativeTap = (): void => {
    if (this.disposed) return;
    if (this.nativeTapWatchTimer !== undefined) clearTimeout(this.nativeTapWatchTimer);
    this.nativeTapWatchTimer = setTimeout(() => {
      this.nativeTapWatchTimer = undefined;
      this.publish({});
    }, NATIVE_TAP_CLAIM_MS);
    this.publish({});
  };

  /** Handles the events of a sheet the composer turned on a tap; false for any other sheet. */
  private handleNativeTapEvent(event: NativePagerEventRecord, token: number): boolean {
    if (event.event === 'consumed') {
      const stock = this.stockLedger.get(token);
      if (!stock || this.drag) return false;
      this.followNativeTap(event, stock);
      return true;
    }
    if (!this.nativeTapSheets.has(event.id)) return false;
    if (event.event === 'completed' || event.event === 'cancelled') {
      this.nativeTapSheets.delete(event.id);
      this.publish({});
      this.scheduleIdleWork();
    }
    return true;
  }

  /**
   * The composer turned to a stocked page on a tap before the runtime moved:
   * the runtime follows it one turn at a time, in order. The composer keeps
   * showing its own page while the runtime publishes the ones it passes.
   */
  private followNativeTap(event: NativePagerEventRecord, stock: ReaderPageTurnStock): void {
    const performanceId = readerPerformanceId('native-tap');
    this.travelDirection = stock.direction;
    this.nativeTapSheets.add(event.id);
    this.nativeFollows.push({
      direction: stock.direction,
      sourceKey: stock.source.key,
      targetKey: stock.target.key,
      performanceId,
    });
    readerPerformanceMark('reader.native.tap', {
      workId: performanceId,
      stock: stock.token,
      direction: stock.direction,
      distance: stock.distance,
      page: stock.target.key,
      nativeAtMs: event.eventAtMs,
    });
    readerDiagnostic(
      'turn.native.tap',
      () => `native=${event.id} page=${stock.target.key} queued=${this.nativeFollows.length}`,
    );
    // The composer has left the page the runtime shows: no drag may start from its pairs.
    this.clearStockTokens();
    this.publish({});
    void this.followNativeTaps();
  }

  private async followNativeTaps(): Promise<void> {
    if (this.following) return;
    this.following = true;
    this.publish({});
    let followed = true;
    try {
      while (this.nativeFollows.length > 0 && !this.disposed) {
        const follow = this.nativeFollows[0]!;
        const current = describeSnapshotIdentity(this.runtime.getSnapshot());
        if (current !== follow.targetKey) {
          if (current !== follow.sourceKey) {
            followed = false;
            break;
          }
          let snapshot: ReaderSnapshot | undefined;
          try {
            snapshot =
              follow.direction > 0
                ? await this.runtime.next(follow.performanceId)
                : await this.runtime.previous(follow.performanceId);
          } catch {
            snapshot = undefined;
          }
          if (!snapshot || snapshot.phase !== 'ready' || describeSnapshotIdentity(snapshot) !== follow.targetKey) {
            readerDiagnostic(
              'turn.native.tap.diverged',
              () => `expected=${follow.targetKey} runtime=${snapshot ? describeSnapshotIdentity(snapshot) : 'none'}`,
            );
            this.nativeFollows.shift();
            followed = false;
            break;
          }
        }
        this.nativeFollows.shift();
      }
    } finally {
      this.following = false;
    }
    if (!followed) this.abandonNativeLead();
    this.publish({});
    if (this.runDeferredTap()) return;
    this.scheduleRefill();
    this.scheduleIdleWork();
  }

  /** The runtime could not follow the composer: the composer shows the runtime's page again. */
  private abandonNativeLead(): void {
    readerDiagnostic(
      'turn.native.tap.abandon',
      () => `runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())}`,
    );
    this.nativeFollows.length = 0;
    this.nativeTapSheets.clear();
    this.forcePresent();
  }

  /** Makes the surface present the runtime's page even where the composer led elsewhere. */
  private forcePresent(): void {
    this.publish({ presentEpoch: this.store.getState().presentEpoch + 1 });
  }

  /** Every pair handed to the composer, by token, so a late event still finds the page it reveals. */
  private rememberStock(stock: ReaderPageTurnStock): void {
    this.stockLedger.delete(stock.token);
    this.stockLedger.set(stock.token, stock);
    while (this.stockLedger.size > STOCK_LEDGER_SIZE) {
      this.stockLedger.delete(this.stockLedger.keys().next().value!);
    }
  }

  // Native sheets.

  private stockTokenFor(direction: 1 | -1) {
    return direction > 0 ? this.values.nativeStockNextToken : this.values.nativeStockPreviousToken;
  }

  private clearStockTokens(): void {
    this.values.nativeStockNextToken.set(0);
    this.values.nativeStockPreviousToken.set(0);
  }

  /** The drag's runtime turn once its preparation settles; undefined when none could be prepared. */
  private preparationOf(state: ReaderDragState): Promise<ReaderPreparedTurn | undefined> {
    if (state.preparedTurn || !state.preparation) return Promise.resolve(state.preparedTurn);
    return state.preparation.then(
      () => state.preparedTurn,
      () => undefined,
    );
  }

  /**
   * Commits what a consumed native sheet revealed: its prepared turn, or,
   * when none could be prepared, a plain navigation the same way so the
   * runtime follows the composer.
   */
  private commitNativeHandoff(handoff: ReaderNativeGestureHandoff): Promise<ReaderNativeCommit> {
    return handoff.preparation.then(async (preparedTurn) => {
      handoff.preparedTurn = preparedTurn;
      if (preparedTurn) {
        return { snapshot: await this.runtime.commitPreparedTurn(preparedTurn), preparedTurn };
      }
      readerDiagnostic('turn.native.commit-unprepared', () => `turn=${handoff.turnId} stock=${handoff.gestureToken}`);
      const snapshot = handoff.direction > 0 ? await this.runtime.next() : await this.runtime.previous();
      return { snapshot };
    });
  }

  private endNativeHandoff(token: number, handoff: ReaderNativeGestureHandoff): void {
    if (this.nativeHandoffs.get(token) !== handoff) return;
    this.nativeHandoffs.delete(token);
    if (this.activeTurnId === handoff.turnId) this.finishTurn();
    else this.publish({});
  }

  // Derived state.

  private publish(partial: Partial<ReaderPageTurnState>): void {
    const previous = this.store.getState();
    const base = { ...previous, ...partial };
    const snapshot = this.subscriberSnapshot;
    const nativeLead = this.nativeFollows.length > 0 || this.following;
    const automaticNavigationActive = this.pendingNavigations > 0 || nativeLead;
    // A released drag waits for its runtime turn before input resumes.
    const isSettling = this.activeTurnId !== undefined && !this.drag;
    const turning =
      automaticNavigationActive ||
      this.drag !== undefined ||
      this.activeTurnId !== undefined ||
      this.nativeTapSheets.size > 0;
    // Events report what the composer did by itself: taps from the moment the
    // UI thread says it took one, and sheets a finger handed it.
    const composerEventsActive =
      this.nativeTapWatchTimer !== undefined ||
      nativeLead ||
      this.nativeTapSheets.size > 0 ||
      this.nativeHandoffs.size > 0;
    const next: ReaderPageTurnState = {
      ...base,
      automaticNavigationActive,
      isSettling,
      turning,
      composerEventsActive,
      nativeGestureDriven: this.nativeGestureDriven,
    };
    if (!shallowEqualState(previous, next)) this.store.setState(next);

    this.values.inputBlocked.set(isSettling || automaticNavigationActive || snapshot.phase !== 'ready');
    if (this.values.nativeTapLead.value !== nativeLead) this.values.nativeTapLead.set(nativeLead);
    // The composer takes taps only while no drag or RN navigation owns the
    // runtime's next move, and the subscriber shows the runtime's page; taps
    // it already leads on keep coming.
    const nativeTaps =
      this.tapGuardEnabled &&
      !this.disposed &&
      !this.drag &&
      this.activeTurnId === undefined &&
      this.pendingNavigations === 0 &&
      (nativeLead || sameSnapshotIdentity(snapshot, this.runtime.getSnapshot()));
    if (this.values.nativeTapEnabled.value !== nativeTaps) this.values.nativeTapEnabled.set(nativeTaps);
    if (this.activeTurnId === undefined) this.values.releasePending.set(false);
    if (turning && !this.backgroundSuspension) {
      this.backgroundSuspension = this.runtime.suspendBackgroundPagination();
    } else if (!turning && this.backgroundSuspension) {
      this.backgroundSuspension();
      this.backgroundSuspension = undefined;
    }
  }

  // Drag preparation.

  private prepareDragTarget(state: ReaderDragState): void {
    state.preparing = true;
    const direction = state.direction;
    const turnDirection = directionName(direction);
    readerDiagnostic(
      'turn.prepare.begin',
      () =>
        `turn=${state.id} direction=${turnDirection} sourceRevision=${state.revisionId} sourceSpread=${state.startSpread}`,
    );
    const preparation = this.runtime.prepareAdjacent(turnDirection, state.performanceId);
    state.preparation = preparation;
    void preparation.then((preparedTurn) => {
      const current = this.drag;
      const handoff = this.nativeHandoffs.get(state.nativeGestureToken);
      const ownedByNative = handoff?.turnId === state.id;
      if (
        (current !== state && !ownedByNative) ||
        state.direction !== direction ||
        this.runtime.getSnapshot().revisionId !== state.revisionId
      ) {
        readerDiagnostic(
          'turn.prepare.stale',
          () =>
            `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} activeTurn=${current?.id ?? 'none'} runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())}`,
        );
        if (preparedTurn && !ownedByNative) void this.runtime.cancelPreparedTurn(preparedTurn);
        return;
      }
      state.preparation = undefined;
      if (preparedTurn) {
        state.preparedTurn = preparedTurn;
        // A drag the composer already took from an idle pair keeps that pair's token.
        if (!state.nativeAccepted) state.nativeGestureToken = ++this.stockTokenSequence;
        if (ownedByNative) handoff.preparedTurn = preparedTurn;
      }
      readerPerformanceMark('reader.turn.ready', {
        workId: state.performanceId,
        turnId: state.id,
        prepared: preparedTurn?.id,
        targetRenderId: preparedTurn?.targetRenderId,
        ready: Boolean(preparedTurn),
      });
      readerDiagnostic(preparedTurn ? 'turn.prepare.ready' : 'turn.prepare.empty', () =>
        preparedTurn
          ? `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)}`
          : `turn=${state.id} direction=${turnDirection} runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())}`,
      );
      if (!preparedTurn || !this.showPreparedTurn(state, preparedTurn)) state.preparing = false;
    });
  }

  /**
   * The drag's target is known: unless the composer already drives the drag,
   * the pair is stocked so the composer can take it from the next move.
   */
  private showPreparedTurn(state: ReaderDragState, preparedTurn: ReaderPreparedTurn): boolean {
    if (this.runtime.getSnapshot().revisionId !== preparedTurn.revisionId) {
      readerDiagnostic(
        'turn.target.reject',
        () =>
          `turn=${state.id} prepared=${preparedTurn.id} reason=revision runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())} expectedRevision=${preparedTurn.revisionId}`,
      );
      return false;
    }
    state.preparedTurn = preparedTurn;
    const target = this.contentForPreparedTurn(preparedTurn, state.source.snapshot);
    if (!target) {
      if (!state.targetUnavailableLogged) {
        state.targetUnavailableLogged = true;
        readerDiagnostic(
          'turn.target.unavailable',
          () => `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)}`,
        );
      }
      return false;
    }
    state.preparing = false;
    state.prepared = true;
    state.target = target;
    readerDiagnostic(
      'turn.target.mount',
      () =>
        `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)} native=${String(state.nativeAccepted === true)}`,
    );
    if (state.nativeAccepted || this.drag !== state) return true;
    // A pair stocked at idle for this very page keeps serving the drag: the
    // composer may already hold its textures, and restocking would make the
    // drag wait for a new upload before the composer can take it.
    const idle = this.store
      .getState()
      .stocks.find(
        (stock) =>
          stock.preparedTurnId === 0 &&
          stock.direction === state.direction &&
          stock.source.key === state.source.key &&
          stock.target.key === target.key,
      );
    if (idle) {
      state.nativeGestureToken = idle.token;
      return true;
    }
    this.publish({
      stocks: this.stocksWithDragPair(
        this.stockFor(state.nativeGestureToken, preparedTurn, state.direction, state.source, target),
      ),
    });
    return true;
  }

  // Release.

  private finishDrag(
    state: ReaderDragState,
    releaseVelocity: number,
    releaseTranslationX: number,
    nativeReleased: boolean,
    release: PageTurnReleaseSample | undefined,
  ): void {
    const { viewport, pageTurnEffect, spreadMode } = this.config;
    readerPerformanceMark('reader.gesture.release', {
      workId: state.performanceId,
      turnId: state.id,
      prepared: state.prepared,
      nativeReleased,
    });
    if (this.drag === state) this.drag = undefined;
    if (!state.directionLocked) {
      readerDiagnostic('turn.gesture.end', () => `turn=${state.id} decision=none reason=direction-unlocked`);
      this.finishTurn();
      return;
    }

    // The composer drives the sheet: its events decide and commit the turn.
    if (nativeReleased && this.nativeHandoffs.has(state.nativeGestureToken)) {
      readerDiagnostic('turn.native.release', () => `turn=${state.id} prepared=${state.preparedTurn?.id ?? 'pending'}`);
      this.publish({});
      return;
    }
    this.nativeHandoffs.delete(state.nativeGestureToken);
    this.nativeGestureDriven = false;

    if (viewport && Number.isFinite(releaseTranslationX)) {
      const leaf = pageTurnLeaf(pageTurnEffect.visual.kind, spreadMode, viewport.width, state.direction);
      const geometry = pageTurnEffect.gesture.getGeometry({
        startBookX: state.startBookX,
        translationX: releaseTranslationX,
        direction: state.direction,
        pageWidth: leaf.width,
      });
      state.fingerX = geometry.fingerX;
      state.physicalProgress = planarTurnProgressForTranslation(releaseTranslationX, state.direction, leaf.width);
      state.renderProgress = pageTurnEffect.gesture.renderProgress({
        physicalProgress: state.physicalProgress,
        direction: state.direction,
        spreadMode,
      });
    }

    // Before the composer took the sheet the page has not moved: a release
    // that commits turns it like a tap would, and one that cancels leaves it.
    const idleDecay = release?.idleDecay ?? 0;
    const throwVelocity = release?.throwVelocity ?? 0;
    const throwAcceleration = release?.throwAcceleration ?? 0;
    const towardTargetVelocity = viewport
      ? ((state.direction === 1 ? -releaseVelocity : releaseVelocity) / Math.max(1, viewport.width)) * idleDecay
      : 0;
    const commit = pageTurnEffect.gesture.shouldCommit({
      progress: state.renderProgress,
      towardTargetVelocity,
      direction: state.direction,
      spreadMode,
      startBookX: state.startBookX,
      fingerX: state.fingerX,
      throwVelocity,
      throwAcceleration,
    });
    readerDiagnostic('turn.release', () =>
      [
        `turn=${state.id}`,
        `direction=${directionName(state.direction)}`,
        `decision=${commit ? 'commit' : 'cancel'}`,
        `renderProgress=${formatTraceNumber(state.renderProgress)}`,
        `velocity=${formatTraceNumber(towardTargetVelocity)}`,
        `prepared=${String(state.prepared)}`,
        `preparedId=${state.preparedTurn?.id ?? 'none'}`,
      ].join(' '),
    );
    const preparedTurn = state.preparedTurn;
    if (!commit) {
      void (preparedTurn ? this.runtime.cancelPreparedTurn(preparedTurn) : Promise.resolve())
        .catch(() => undefined)
        .then(() => {
          if (this.activeTurnId === state.id) this.finishTurn();
        });
      this.publish({});
      return;
    }
    this.travelDirection = state.direction;
    this.clearStockTokens();
    this.publish({ stocks: [] });
    const direction = state.direction;
    void this.withNavigationIntent(direction, () =>
      preparedTurn
        ? this.runtime.commitPreparedTurn(preparedTurn)
        : direction > 0
          ? this.runtime.next(state.performanceId)
          : this.runtime.previous(state.performanceId),
    )
      .catch(() => undefined)
      .then(() => {
        readerPerformanceMark('reader.turn.complete', { workId: state.performanceId, mode: 'gesture' });
        if (this.activeTurnId === state.id) this.finishTurn();
      });
  }

  /** Clears the finished input turn and lets queued input or idle preparation continue. */
  private finishTurn(): void {
    this.activeTurnId = undefined;
    this.nativeGestureDriven = false;
    // Pairs leaving another page are spent. Those already refilled around the
    // page this turn revealed stay, so the next drag needs no idle wait.
    const shown = describeSnapshotIdentity(this.subscriberSnapshot);
    const current = this.store.getState().stocks;
    const kept = current.filter((stock) => stock.around === shown);
    // Unchanged pairs keep their identity, so the surface does not resubmit them.
    const stocks = kept.length === current.length ? current : kept;
    for (const direction of [1, -1] as const) {
      const token = this.stockTokenFor(direction).value;
      if (!stocks.some((stock) => stock.direction === direction && stock.token === token)) {
        this.stockTokenFor(direction).set(0);
      }
    }
    this.publish({ stocks });
    if (this.runDeferredTap()) return;
    this.scheduleRefill();
    this.scheduleIdleWork();
  }

  /** Runs the tap that waited for a turn to end; false when none waited or the turn is not over. */
  private runDeferredTap(): boolean {
    const deferred = this.deferredTap;
    if (!deferred || this.navigationBusy()) return false;
    this.deferredTap = undefined;
    this.travelDirection = deferred.direction;
    const turns = Array.from({ length: deferred.count }, () => this.enqueueNavigation(deferred.direction));
    void Promise.all(turns).then(
      (snapshots) => {
        for (const resolve of deferred.resolvers) resolve(snapshots.at(-1) ?? this.runtime.getSnapshot());
      },
      () => {
        for (const resolve of deferred.resolvers) resolve(this.runtime.getSnapshot());
      },
    );
    return true;
  }

  /** A drag, a released drag, or the runtime following the composer: RN navigation waits for it. */
  private navigationBusy(): boolean {
    return (
      this.drag !== undefined || this.activeTurnId !== undefined || this.nativeFollows.length > 0 || this.following
    );
  }

  // RN navigation.

  private navigate(direction: 1 | -1): Promise<ReaderSnapshot> {
    if (this.disposed) return Promise.resolve(this.runtime.getSnapshot());
    this.travelDirection = direction;
    // A tap during a drag, a released drag, or while the runtime follows the
    // composer runs right after it instead of tearing it down; the latest
    // direction wins.
    if (this.navigationBusy()) {
      const deferred = this.deferredTap ?? { direction, count: 0, resolvers: [] };
      deferred.count = deferred.direction === direction ? deferred.count + 1 : 1;
      deferred.direction = direction;
      this.deferredTap = deferred;
      return new Promise((resolve) => deferred.resolvers.push(resolve));
    }
    return this.enqueueNavigation(direction);
  }

  /**
   * Moves the runtime one page at a time, in request order. Each page it
   * publishes on the way is announced to the surface as turned to.
   */
  private enqueueNavigation(direction: 1 | -1): Promise<ReaderSnapshot> {
    const generation = this.navigationGeneration;
    const performanceId = readerPerformanceId('automatic');
    this.pendingNavigations += 1;
    this.clearIdleTimer();
    this.publish({});
    return new Promise<ReaderSnapshot>((resolve, reject) => {
      const run = async () => {
        try {
          if (this.navigationGeneration !== generation) {
            resolve(this.runtime.getSnapshot());
            return;
          }
          resolve(
            await this.withNavigationIntent(direction, () =>
              direction > 0 ? this.runtime.next(performanceId) : this.runtime.previous(performanceId),
            ),
          );
        } catch (error) {
          reject(error);
        } finally {
          this.pendingNavigations = Math.max(0, this.pendingNavigations - 1);
          this.publish({});
          if (this.pendingNavigations === 0) {
            this.scheduleRefill();
            this.scheduleIdleWork();
          }
        }
      };
      this.navigationQueue = this.navigationQueue.then(run, run);
    });
  }

  /** Runs `navigation`, announcing the pages the runtime publishes meanwhile as turned to. */
  private async withNavigationIntent(
    direction: 1 | -1,
    navigation: () => Promise<ReaderSnapshot>,
  ): Promise<ReaderSnapshot> {
    const before = this.runtime.getSnapshot();
    this.navigationDirection = direction;
    try {
      const result = await navigation();
      // A runtime that published synchronously, or not through subscribers.
      if (result.phase === 'ready' && !sameSnapshotIdentity(before, result)) this.announceTurn(result, direction);
      return result;
    } finally {
      this.navigationDirection = undefined;
    }
  }

  private announceTurn(snapshot: ReaderSnapshot, direction: 1 | -1): void {
    const key = describeSnapshotIdentity(snapshot);
    if (this.turnIntents.has(key)) return;
    this.turnIntents.set(key, direction);
    while (this.turnIntents.size > TURN_INTENT_LIMIT) {
      this.turnIntents.delete(this.turnIntents.keys().next().value!);
    }
  }

  // Runtime notifications.

  private readonly handleRuntimeSnapshot = (snapshot: ReaderSnapshot): void => {
    const direction = this.navigationDirection;
    if (direction !== undefined && snapshot.phase === 'ready') this.announceTurn(snapshot, direction);
  };

  // Idle preparation.

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private isIdle(snapshot: ReaderSnapshot): boolean {
    return this.canPeekAround(snapshot) && this.activeTurnId === undefined && this.nativeTapSheets.size === 0;
  }

  /**
   * Whether the neighbors of `snapshot` may be peeked and stocked: it is the
   * page the subscriber shows and the runtime has settled on, and no drag,
   * queued navigation or composer turn the runtime has yet to follow is about
   * to leave it. A turn that revealed it may still be animating.
   */
  private canPeekAround(snapshot: ReaderSnapshot): boolean {
    return (
      !this.disposed &&
      snapshot.phase === 'ready' &&
      !this.drag &&
      this.pendingNavigations === 0 &&
      this.nativeFollows.length === 0 &&
      !this.following &&
      sameSnapshotIdentity(snapshot, this.subscriberSnapshot) &&
      sameSnapshotIdentity(snapshot, this.runtime.getSnapshot())
    );
  }

  private scheduleIdleWork(): void {
    this.clearIdleTimer();
    const snapshot = this.subscriberSnapshot;
    if (!this.isIdle(snapshot)) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (!this.isIdle(snapshot)) return;
      this.peekAround(snapshot);
    }, WARM_DELAY_MS);
  }

  /**
   * Stocks the neighbors of a page a turn has just revealed, while that turn
   * is still animating: a reader turning page after page then finds the next
   * pair already held by the composer, instead of both waiting for the turn to
   * end and the reader to idle.
   */
  private scheduleRefill(): void {
    const snapshot = this.subscriberSnapshot;
    if (this.refillTimer !== undefined || !this.canPeekAround(snapshot) || this.peekedKey === peekKey(snapshot)) {
      return;
    }
    // Yield once, so the subscriber commits the revealed page before the peek compiles its neighbors.
    this.refillTimer = setTimeout(() => {
      this.refillTimer = undefined;
      if (this.canPeekAround(snapshot)) this.peekAround(snapshot);
    }, 0);
  }

  /** Peeks the neighbors of `snapshot`, the way it was last turned first, and stocks them. */
  private peekAround(snapshot: ReaderSnapshot): void {
    const key = peekKey(snapshot);
    if (this.peekedKey === key) return;
    void this.runtime
      .peekAdjacentPages(snapshot.revisionId, snapshot.spreadIndex, directionName(this.travelDirection))
      .then((pages) => {
        // A peek cut short by queued navigation is tried again once the reader settles.
        const reachable = (['next', 'previous'] as const).filter((direction) => this.runtime.canNavigate(direction));
        const complete = reachable.every((direction) => pages.some((page) => page.direction === direction));
        if (this.stockPages(snapshot, pages) && complete) this.peekedKey = key;
      })
      .catch(() => undefined);
  }

  /**
   * Stocks the pages around the visible one, so the composer can take the
   * next tap or drag either way from its first frame. False when the page
   * moved on first.
   */
  private stockPages(snapshot: ReaderSnapshot, pages: readonly ReaderAdjacentPage[]): boolean {
    if (!this.canPeekAround(snapshot)) return false;
    // Without a native turn the peek only compiled the neighbors' Pictures.
    if (!this.config.pageTurnEffect.native) return true;
    const shown = readerPageContentForSnapshot(this.runtime, snapshot);
    if (!shown) return false;
    const previous = this.store.getState().stocks;
    const stocks: ReaderPageTurnStock[] = [];
    // Each page is reached from the one before it the same way, so the pairs
    // chain outward: a tap the composer takes from the first finds the next.
    const reached = new Map<string, ReaderPageContent>();
    for (const page of pages) {
      const direction = page.direction === 'next' ? 1 : -1;
      const source = page.distance === 1 ? shown : reached.get(`${page.direction}:${page.distance - 1}`);
      if (!source) continue;
      const target: ReaderPageContent = {
        key: describeSnapshotIdentity(page.snapshot),
        snapshot: page.snapshot,
        picture: page.picture,
        frame: page.frame,
      };
      reached.set(`${page.direction}:${page.distance}`, target);
      // The same pair keeps its token, so a stocked composer is not asked again.
      const kept = previous.find(
        (stock) =>
          stock.direction === direction &&
          stock.source.key === source.key &&
          stock.target.key === target.key &&
          sameChrome(stock.source.snapshot, source.snapshot) &&
          sameChrome(stock.target.snapshot, target.snapshot),
      );
      const stock: ReaderPageTurnStock = kept
        ? { ...kept, around: shown.key, distance: page.distance }
        : {
            token: ++this.stockTokenSequence,
            preparedTurnId: 0,
            direction,
            source,
            target,
            around: shown.key,
            distance: page.distance,
            performanceId: readerPerformanceId('stock'),
          };
      this.rememberStock(stock);
      stocks.push(kept && kept.around === stock.around && kept.distance === stock.distance ? kept : stock);
    }
    for (const direction of [1, -1] as const) {
      const token = stocks.find((stock) => stock.direction === direction && stock.distance === 1)?.token;
      if (this.stockTokenFor(direction).value !== token) this.stockTokenFor(direction).set(0);
    }
    readerDiagnostic(
      'turn.stock.refill',
      () => `around=${shown.key} ${stocks.map((stock) => `${stock.source.key}->${stock.target.key}`).join(' ')}`,
    );
    this.publish({ stocks: sameStocks(previous, stocks) ? previous : stocks });
    return true;
  }

  /** The stocked pairs with a drag's own pair in place of the one leaving its page in its direction. */
  private stocksWithDragPair(stock: ReaderPageTurnStock | undefined): readonly ReaderPageTurnStock[] {
    const others = this.store
      .getState()
      .stocks.filter((candidate) => !(candidate.direction === stock?.direction && candidate.distance === 1));
    return stock ? [stock, ...others] : others;
  }

  private stockFor(
    token: number,
    preparedTurn: ReaderPreparedTurn,
    direction: 1 | -1,
    source: ReaderPageContent,
    target: ReaderPageContent,
  ): ReaderPageTurnStock | undefined {
    if (token <= 0) return undefined;
    // A new stock replaces the composer's pair for this page and direction;
    // until it is uploaded no drag may start from the previous token.
    if (this.stockTokenFor(direction).value !== token) this.stockTokenFor(direction).set(0);
    const stock: ReaderPageTurnStock = {
      token,
      preparedTurnId: preparedTurn.id,
      direction,
      source,
      target,
      around: source.key,
      distance: 1,
      performanceId: preparedTurn.performanceId,
    };
    this.rememberStock(stock);
    return stock;
  }

  private contentForPreparedTurn(
    preparedTurn: ReaderPreparedTurn,
    sourceSnapshot: ReaderSnapshot | undefined,
  ): ReaderPageContent | undefined {
    const picture = this.runtime.getCurrentPicture(
      preparedTurn.revisionId,
      preparedTurn.targetSpreadIndex,
      preparedTurn.targetRenderId,
    );
    const frame = this.runtime.getCurrentFrame(preparedTurn.targetSpreadIndex);
    const snapshot =
      this.runtime.getPreparedTargetSnapshot(preparedTurn) ??
      (sourceSnapshot
        ? { ...sourceSnapshot, spreadIndex: preparedTurn.targetSpreadIndex, renderId: preparedTurn.targetRenderId }
        : undefined);
    if (!picture || !frame || !snapshot) return undefined;
    return { key: describePreparedTarget(preparedTurn), snapshot, picture, frame };
  }
}

function directionName(direction: 1 | -1): ReaderTurnDirection {
  return direction > 0 ? 'next' : 'previous';
}

/** A page is peeked again when what its chrome shows changes, so the stocked textures match the surface. */
function peekKey(snapshot: ReaderSnapshot): string {
  return JSON.stringify([
    describeSnapshotIdentity(snapshot),
    snapshot.chapterTitle,
    snapshot.bookSpreadIndex,
    snapshot.totalSpreads,
  ]);
}

/** Whether two snapshots of a page paint the same chrome. */
function sameChrome(left: ReaderSnapshot, right: ReaderSnapshot): boolean {
  return (
    left.chapterTitle === right.chapterTitle &&
    left.bookSpreadIndex === right.bookSpreadIndex &&
    left.totalSpreads === right.totalSpreads
  );
}

function sameStocks(left: readonly ReaderPageTurnStock[], right: readonly ReaderPageTurnStock[]): boolean {
  return left.length === right.length && left.every((stock, index) => stock === right[index]);
}

function shallowEqualState(left: ReaderPageTurnState, right: ReaderPageTurnState): boolean {
  return (
    left.automaticNavigationActive === right.automaticNavigationActive &&
    left.isSettling === right.isSettling &&
    left.turning === right.turning &&
    left.stocks === right.stocks &&
    left.composerEventsActive === right.composerEventsActive &&
    left.nativeGestureDriven === right.nativeGestureDriven &&
    left.presentEpoch === right.presentEpoch
  );
}
