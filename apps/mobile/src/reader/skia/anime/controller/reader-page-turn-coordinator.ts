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
import type { ReaderInteractiveTurn, ReaderPageContent } from '../core/page-turn-types';
import { planarTurnProgressForTranslation, type PageTurnReleaseSample } from '../gesture/page-turn-gesture';
import type { PageTurnGestureValues } from '../gesture/use-page-turn-pan-gesture';
import { readerInteractivePageTurnIdentity } from '../native/page-turn';
import {
  acknowledgeNativePagerPresentationById,
  cancelNativePagerGestureOnUI,
  type NativePagerEventRecord,
} from '../native/pager-compositor';
import type {
  ReaderCommittedHandoff,
  ReaderDragState,
  ReaderNativeCommit,
  ReaderNativeGestureHandoff,
} from './interactive-page-turn-state';
import { AutomaticPageTurnQueue } from './automatic-page-turn-queue';
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
const PAGE_TURN_SETTLE_FALLBACK_DELAY_MS = 180;

interface DeferredTap {
  direction: 1 | -1;
  readonly resolvers: ((snapshot: ReaderSnapshot) => void)[];
}

/**
 * Owns every page turn of one reader runtime: finger drags, released sheets,
 * taps and their native handoffs. It is a plain object so that turn
 * bookkeeping never re-renders the reader screen; React only reads the store
 * slices it draws.
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
  private activeTurnId?: number;
  private handoffGeneration = 0;
  private readonly nativeHandoffs = new Map<number, ReaderNativeGestureHandoff>();
  private committedHandoff?: ReaderCommittedHandoff;
  private stockTokenSequence = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private refillTimer?: ReturnType<typeof setTimeout>;
  /** The page whose neighbors were last peeked in full. */
  private peekedKey?: string;
  /** The way the reader last turned; its neighbor that way is peeked first. */
  private travelDirection: 1 | -1 = 1;
  private deferredTap?: DeferredTap;
  private readonly automatic: AutomaticPageTurnQueue;

  constructor(
    readonly runtime: LunarReaderRuntime,
    private readonly values: PageTurnGestureValues,
    config: ReaderPageTurnConfig,
  ) {
    this.config = config;
    this.subscriberSnapshot = runtime.getSnapshot();
    this.automatic = new AutomaticPageTurnQueue({
      runtime,
      pageTurnEffect: () => this.config.pageTurnEffect,
      turns: () => this.store.getState().automaticTurns,
      publishTurns: (automaticTurns) => this.publish({ automaticTurns }),
      pendingChanged: () => {
        this.clearIdleTimer();
        this.publish({});
      },
      beforeNavigate: () => this.prepareForAutomaticNavigation(),
      navigate: (direction, performanceId) =>
        direction > 0 ? runtime.next(performanceId) : runtime.previous(performanceId),
      settled: () => {
        // The last queued tap has landed: its page's neighbors can be read while it animates.
        this.scheduleRefill();
        this.scheduleIdleWork();
      },
    });
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

  /** The snapshot the subscriber renders; release waits for it, never for the runtime's own. */
  setSubscriberSnapshot(snapshot: ReaderSnapshot): void {
    if (snapshot === this.subscriberSnapshot) return;
    this.subscriberSnapshot = snapshot;
    const stocks = this.store.getState().stocks;
    // Pairs stocked at idle leave the page they were stocked on. Once another
    // page shows outside a drag (a tap, a jump), no drag can start from them.
    const staleStocks =
      !this.drag &&
      this.activeTurnId === undefined &&
      stocks.some((stock) => !sameSnapshotIdentity(stock.source.snapshot, snapshot));
    if (staleStocks) this.clearStockTokens();
    this.publish(staleStocks ? { stocks: [] } : {});
    this.continueCommittedHandoff();
    this.scheduleRefill();
    this.scheduleIdleWork();
  }

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
    this.handoffGeneration += 1;
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
      pendingPublished: false,
      startBookX: 1,
      physicalProgress: 0,
      renderProgress: 0,
      grabX: Math.min(viewport.width, Math.max(0, startX)),
      grabY: startY,
      fingerX: 1,
      pressedEdgeX: 1,
      heldRollTilt: 0,
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
  };

  readonly updateDrag = (
    translationX: number,
    absoluteY: number,
    throwVelocity: number,
    throwAcceleration: number,
  ): void => {
    const state = this.drag;
    const { viewport, pageTurnEffect, spreadMode, surfaceTop } = this.config;
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
    state.startBookX = pageTurnEffect.gesture.getStartBookX(state.startX, direction, viewport.width);
    const geometry = pageTurnEffect.gesture.getGeometry({
      startBookX: state.startBookX,
      translationX,
      direction,
      pageWidth: viewport.width,
    });
    state.fingerX = geometry.fingerX;
    state.heldRollTilt = geometry.heldRollTilt;
    state.pressedEdgeX = geometry.pressedEdgeX;
    state.physicalProgress = planarTurnProgressForTranslation(translationX, direction, viewport.width);
    state.renderProgress = pageTurnEffect.gesture.renderProgress({
      physicalProgress: state.physicalProgress,
      direction,
      spreadMode,
    });
    // The pan gesture tracks the throw on the UI runtime at every sample;
    // this side only sees some of them, so it adopts that track as is.
    state.throwAcceleration = throwAcceleration;
    state.throwVelocity = throwVelocity;
    state.grabY = Math.min(viewport.height, Math.max(0, absoluteY - surfaceTop));

    if (state.preparedTurn && !state.prepared) {
      this.showPreparedTurn(state, state.preparedTurn);
      return;
    }
    if (state.preparing || state.prepared) return;

    if (!state.pendingPublished && pageTurnEffect.visual.kind === 'slide') {
      state.pendingPublished = true;
      this.publishInteractive({
        performanceId: state.performanceId,
        source: state.source,
        direction,
        progress: state.renderProgress,
        progressValue: this.values.progress,
        grabX: state.grabX,
        grabY: state.grabY,
        grabYValue: this.values.grabY,
      });
    }
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
    if (!state || !state.directionLocked || !stock || stock.direction !== state.direction) {
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
    if (!state.preparation && !state.preparedTurn && !state.preparing) this.prepareDragTarget(state);
    if (!this.nativeHandoffs.has(stockToken)) {
      this.nativeHandoffs.set(stockToken, {
        turnId: state.id,
        gestureToken: stockToken,
        direction: state.direction,
        preparation: this.preparationOf(state),
        preparedTurn: state.preparedTurn,
        generation: ++this.handoffGeneration,
        terminalEventHandled: false,
      });
    }
    readerPerformanceMark('reader.native.accepted', {
      workId: state.performanceId,
      turnId: state.id,
      stock: stockToken,
      prepared: state.preparedTurn?.id ?? 0,
    });
    const nativeGesture = {
      token: stockToken,
      preparedTurnId: state.preparedTurn?.id ?? stock.preparedTurnId,
      targetKey: stock.target.key,
      driven: true,
      settling: false,
      consumed: false,
    };
    const current = this.store.getState().interactiveTurn;
    this.publishInteractive({
      ...current,
      performanceId: state.performanceId,
      source: state.source,
      // The composer reveals the stocked target; a prepared target replaces it once known.
      content: state.target ?? current?.content ?? stock.target,
      direction: state.direction,
      progress: state.renderProgress,
      progressValue: this.values.progress,
      grabX: state.grabX,
      grabY: state.grabY,
      grabYValue: this.values.grabY,
      nativeGesture,
    });
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
    if (state.preparation && !state.preparedTurn) {
      readerPerformanceMark('reader.gesture.wait-prepare', { workId: state.performanceId });
      readerDiagnostic(
        'turn.release.wait-prepare',
        () =>
          `turn=${state.id} translationX=${formatTraceNumber(releaseTranslationX)} velocityX=${formatTraceNumber(releaseVelocity)}`,
      );
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
    const preparedId = handoff?.preparedTurn?.id;
    if (
      !handoff ||
      (identity.preparedTurnId > 0 && preparedId !== undefined && preparedId !== identity.preparedTurnId)
    ) {
      if (event.event === 'consumed') {
        // Native advanced past a pair nobody will commit. Re-anchor it on the
        // visible page rather than letting it drift from the runtime.
        readerDiagnostic('turn.native.unowned', () => `native=${event.id}`);
        this.publish({ nativeResetEpoch: this.store.getState().nativeResetEpoch + 1 });
      }
      return;
    }
    readerDiagnostic(
      'turn.native.event',
      () =>
        `turn=${identity.gestureToken} prepared=${handoff.preparedTurn?.id ?? 'pending'} event=${event.event} native=${event.id}`,
    );
    if (event.event === 'consumed' && !handoff.commit) {
      this.updateInteractive((turn) =>
        turn.nativeGesture?.token === identity.gestureToken
          ? {
              ...turn,
              settling: false,
              nativeGesture: { ...turn.nativeGesture, consumed: true, settling: false },
            }
          : turn,
      );
      // The composer now anchors on the target: every pair left the old page.
      this.travelDirection = handoff.direction;
      this.clearStockTokens();
      this.publish({ stocks: [] });
      handoff.commit = this.commitNativeHandoff(handoff);
      return;
    }
    if (handoff.terminalEventHandled || (event.event !== 'completed' && event.event !== 'cancelled')) return;
    handoff.terminalEventHandled = true;
    if (event.event === 'cancelled') {
      void handoff.preparation
        .then((preparedTurn) => (preparedTurn ? this.runtime.cancelPreparedTurn(preparedTurn) : undefined))
        .catch(() => undefined)
        .then(waitForPageHandoffFrames)
        .then(() => {
          if (this.nativeHandoffs.get(identity.gestureToken) !== handoff) return;
          this.nativeHandoffs.delete(identity.gestureToken);
          if (this.activeTurnId !== handoff.turnId) return;
          this.finishTurn();
        });
      return;
    }

    const commit = handoff.commit ?? this.commitNativeHandoff(handoff);
    handoff.commit = commit;
    void commit
      .then(({ snapshot: result, preparedTurn }) => {
        if (this.nativeHandoffs.get(identity.gestureToken) !== handoff) return;
        this.nativeHandoffs.delete(identity.gestureToken);
        const expected = preparedTurn
          ? {
              revisionId: preparedTurn.revisionId,
              spreadIndex: preparedTurn.targetSpreadIndex,
              renderId: preparedTurn.targetRenderId,
            }
          : result;
        if (
          result.phase !== 'ready' ||
          result.revisionId !== expected.revisionId ||
          result.spreadIndex !== expected.spreadIndex ||
          result.renderId !== expected.renderId
        ) {
          if (this.activeTurnId === handoff.turnId) this.finishTurn();
          return;
        }
        if (this.activeTurnId !== handoff.turnId) {
          // An older sheet finished after a newer input took over.
          acknowledgeNativePagerPresentationById(this.values.nativePagerId.value, event.id);
          return;
        }
        this.beginCommittedHandoff({
          performanceId: preparedTurn?.performanceId,
          turnId: handoff.turnId,
          generation: handoff.generation,
          revisionId: expected.revisionId,
          spreadIndex: expected.spreadIndex,
          renderId: expected.renderId ?? 0,
          nativeTurnId: event.id,
        });
      })
      .catch(() => {
        if (this.nativeHandoffs.get(identity.gestureToken) !== handoff) return;
        this.nativeHandoffs.delete(identity.gestureToken);
        if (this.activeTurnId === handoff.turnId) this.finishTurn();
      });
  };

  /** Reports that the composer now holds the pair stocked under this token. */
  readonly markStocked = (token: number): void => {
    const stock = this.store.getState().stocks.find((candidate) => candidate.token === token);
    if (!stock || this.nativeHandoffs.has(token)) return;
    this.stockTokenFor(stock.direction).set(token);
    readerPerformanceMark('reader.native.stocked', {
      workId: stock.performanceId,
      stock: token,
      direction: stock.direction,
      idle: stock.preparedTurnId === 0,
    });
  };

  /** The composer was re-anchored and dropped every stocked pair. */
  readonly markStockLost = (): void => {
    this.clearStockTokens();
  };

  // Tap and programmatic navigation.

  readonly next = (): Promise<ReaderSnapshot> => this.navigate(1);
  readonly previous = (): Promise<ReaderSnapshot> => this.navigate(-1);

  readonly completeAutomaticTurn = (turnId: number): void => {
    if (this.automatic.complete(turnId)) this.scheduleIdleWork();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const detach of this.detachments.splice(0)) detach();
    this.clearIdleTimer();
    if (this.refillTimer !== undefined) clearTimeout(this.refillTimer);
    this.refillTimer = undefined;
    this.automatic.dispose();
    this.handoffGeneration += 1;
    this.nativeHandoffs.clear();
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

  // Derived state.

  private publish(partial: Partial<ReaderPageTurnState>): void {
    const previous = this.store.getState();
    const base = { ...previous, ...partial };
    const snapshot = this.subscriberSnapshot;
    const turn = base.interactiveTurn;
    const consumedTargetReady =
      turn?.nativeGesture?.consumed === true &&
      turn.content !== undefined &&
      sameSnapshotIdentity(snapshot, turn.content.snapshot);
    const isSettling =
      !consumedTargetReady &&
      (turn?.settling === true || turn?.nativeGesture?.settling === true || turn?.nativeGesture?.consumed === true);
    const automaticNavigationActive = this.automatic.pending > 0 || base.automaticTurns.length > 0;
    const next: ReaderPageTurnState = { ...base, isSettling, automaticNavigationActive };
    if (!shallowEqualState(previous, next)) this.store.setState(next);

    this.values.inputBlocked.set(isSettling || automaticNavigationActive || snapshot.phase !== 'ready');
    if ((consumedTargetReady && !this.drag) || this.activeTurnId === undefined) {
      this.values.releasePending.set(false);
    }
    const turning = automaticNavigationActive || turn !== undefined;
    if (turning && !this.backgroundSuspension) {
      this.backgroundSuspension = this.runtime.suspendBackgroundPagination();
    } else if (!turning && this.backgroundSuspension) {
      this.backgroundSuspension();
      this.backgroundSuspension = undefined;
    }
  }

  private publishInteractive(turn: ReaderInteractiveTurn | undefined): void {
    this.publish({ interactiveTurn: turn });
  }

  private updateInteractive(update: (turn: ReaderInteractiveTurn) => ReaderInteractiveTurn): void {
    const turn = this.store.getState().interactiveTurn;
    if (turn) this.publishInteractive(update(turn));
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
      if (
        current !== state ||
        current.direction !== direction ||
        this.runtime.getSnapshot().revisionId !== state.revisionId
      ) {
        readerDiagnostic(
          'turn.prepare.stale',
          () =>
            `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} activeTurn=${current?.id ?? 'none'} runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())}`,
        );
        if (preparedTurn) void this.runtime.cancelPreparedTurn(preparedTurn);
        return;
      }
      state.preparation = undefined;
      if (preparedTurn) {
        state.preparedTurn = preparedTurn;
        // A drag the composer already took from an idle pair keeps that pair's token.
        if (!state.nativeAccepted) state.nativeGestureToken = ++this.stockTokenSequence;
        const handoff = this.nativeHandoffs.get(state.nativeGestureToken);
        if (handoff?.turnId === state.id) handoff.preparedTurn = preparedTurn;
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

  private showPreparedTurn(
    state: ReaderDragState,
    preparedTurn: ReaderPreparedTurn,
    knownTarget?: ReaderPageContent,
  ): boolean {
    if (this.runtime.getSnapshot().revisionId !== preparedTurn.revisionId) {
      readerDiagnostic(
        'turn.target.reject',
        () =>
          `turn=${state.id} prepared=${preparedTurn.id} reason=revision runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())} expectedRevision=${preparedTurn.revisionId}`,
      );
      return false;
    }
    state.preparedTurn = preparedTurn;
    const target = knownTarget ?? this.contentForPreparedTurn(preparedTurn, state.source.snapshot);
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
        `turn=${state.id} prepared=${preparedTurn.id} sourceSpread=${preparedTurn.sourceSnapshotSpreadIndex} target=${describePreparedTarget(preparedTurn)} progress=${formatTraceNumber(state.renderProgress)} native=${String(state.nativeAccepted === true)}`,
    );
    if (state.nativeAccepted) {
      // The composer already moves this sheet: only the runtime's target is new.
      this.updateInteractive((turn) => ({
        ...turn,
        content: target,
        nativeGesture: turn.nativeGesture ? { ...turn.nativeGesture, preparedTurnId: preparedTurn.id } : undefined,
      }));
      return true;
    }
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
    if (idle) state.nativeGestureToken = idle.token;
    this.publish({
      interactiveTurn: {
        performanceId: state.performanceId,
        source: state.source,
        content: target,
        direction: state.direction,
        progress: state.renderProgress,
        progressValue: this.values.progress,
        grabX: state.grabX,
        grabY: state.grabY,
        grabYValue: this.values.grabY,
        pressedEdgeX: state.pressedEdgeX,
        pressedEdgeXValue: this.values.pressedEdgeX,
        heldRollTilt: state.heldRollTilt,
        heldRollTiltValue: this.values.heldRollTilt,
        fingerX: state.fingerX,
        startBookX: state.startBookX,
        throwVelocity: state.throwVelocity,
        throwAcceleration: state.throwAcceleration,
        nativeGesture: {
          token: state.nativeGestureToken,
          preparedTurnId: preparedTurn.id,
          targetKey: target.key,
          driven: false,
          settling: false,
          consumed: false,
        },
      },
      stocks: idle
        ? this.store.getState().stocks
        : this.stocksWithDragPair(
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
    const { viewport, pageTurnEffect, spreadMode, animationDuration } = this.config;
    readerPerformanceMark('reader.gesture.release', {
      workId: state.performanceId,
      turnId: state.id,
      prepared: state.prepared,
      nativeReleased,
    });
    if (this.drag === state) this.drag = undefined;
    if (!nativeReleased) this.nativeHandoffs.delete(state.nativeGestureToken);
    if (!state.directionLocked) {
      readerDiagnostic('turn.gesture.end', () => `turn=${state.id} decision=none reason=direction-unlocked`);
      this.activeTurnId = undefined;
      this.values.releasePending.set(false);
      this.finishTurn();
      return;
    }

    if (viewport && Number.isFinite(releaseTranslationX)) {
      const geometry = pageTurnEffect.gesture.getGeometry({
        startBookX: state.startBookX,
        translationX: releaseTranslationX,
        direction: state.direction,
        pageWidth: viewport.width,
      });
      state.fingerX = geometry.fingerX;
      state.heldRollTilt = geometry.heldRollTilt;
      state.pressedEdgeX = geometry.pressedEdgeX;
      state.physicalProgress = planarTurnProgressForTranslation(releaseTranslationX, state.direction, viewport.width);
      state.renderProgress = pageTurnEffect.gesture.renderProgress({
        physicalProgress: state.physicalProgress,
        direction: state.direction,
        spreadMode,
      });
    }

    // Decide on the sample the pan gesture handed the native pager, so the
    // declarative path and the composer settle the same drag the same way.
    // A cancelled pan carries no sample and therefore no throw.
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
        `physicalProgress=${formatTraceNumber(state.physicalProgress)}`,
        `renderProgress=${formatTraceNumber(state.renderProgress)}`,
        `velocity=${formatTraceNumber(towardTargetVelocity)}`,
        `prepared=${String(state.prepared)}`,
        `preparedId=${state.preparedTurn?.id ?? 'none'}`,
      ].join(' '),
    );
    const settleContext = {
      fromProgress: state.renderProgress,
      releaseVelocity: towardTargetVelocity,
      throwVelocity,
      animationDuration,
      pageWidth: viewport?.width ?? 0,
      direction: state.direction,
      spreadMode,
      fingerX: state.fingerX,
      pressedEdgeX: state.pressedEdgeX,
      heldRollTilt: state.heldRollTilt,
      startBookX: state.startBookX,
    };

    if (nativeReleased && (state.nativeAccepted || (state.preparedTurn && state.prepared))) {
      const existing = this.nativeHandoffs.get(state.nativeGestureToken);
      const generation = existing ? existing.generation : ++this.handoffGeneration;
      if (!existing) {
        this.nativeHandoffs.set(state.nativeGestureToken, {
          turnId: state.id,
          gestureToken: state.nativeGestureToken,
          direction: state.direction,
          preparation: this.preparationOf(state),
          preparedTurn: state.preparedTurn,
          generation,
          terminalEventHandled: false,
        });
      }
      this.updateInteractive((turn) => ({
        ...turn,
        progress: state.renderProgress,
        progressValue: this.values.progress,
        pressedEdgeX: state.pressedEdgeX,
        heldRollTilt: state.heldRollTilt,
        fingerX: state.fingerX,
        startBookX: state.startBookX,
        releaseVelocity: towardTargetVelocity,
        throwVelocity,
        settling: true,
        settleTo: commit ? 1 : 0,
        nativeGesture: turn.nativeGesture ? { ...turn.nativeGesture, driven: true, settling: true } : undefined,
      }));
      readerDiagnostic(
        'turn.native.release',
        () =>
          `turn=${state.id} prepared=${state.preparedTurn?.id} expected=${commit ? 'commit' : 'cancel'} generation=${generation}`,
      );
      return;
    }

    if (!commit) {
      const preparedTurn = state.preparedTurn;
      if (!state.prepared) {
        if (preparedTurn) void this.runtime.cancelPreparedTurn(preparedTurn);
        readerDiagnostic(
          'turn.cancel.clear',
          () => `turn=${state.id} mode=without-mounted-target prepared=${preparedTurn?.id ?? 'none'}`,
        );
        this.activeTurnId = undefined;
        this.values.releasePending.set(false);
        this.finishTurn();
        return;
      }
      const settleDuration = pageTurnEffect.motion.getSettleDuration({ ...settleContext, targetProgress: 0 });
      const generation = ++this.handoffGeneration;
      const visualSettle = this.settleInteractive(state, 0, settleDuration, towardTargetVelocity, throwVelocity, true);
      readerDiagnostic(
        'turn.cancel.begin',
        () => `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} durationMs=${settleDuration}`,
      );
      void visualSettle
        .then(() => {
          readerDiagnostic(
            'turn.cancel.visual-ready',
            () => `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} generation=${generation}`,
          );
          return preparedTurn ? this.runtime.cancelPreparedTurn(preparedTurn) : undefined;
        })
        .catch(() => undefined)
        .then(waitForPageHandoffFrames)
        .then(() => {
          if (this.handoffGeneration !== generation) return;
          readerDiagnostic(
            'turn.cancel.clear',
            () =>
              `turn=${state.id} runtime=${describeSnapshotIdentity(this.runtime.getSnapshot())} generation=${generation}`,
          );
          readerPerformanceMark('reader.turn.complete', {
            workId: state.performanceId,
            cancelled: true,
            mode: 'gesture',
          });
          this.finishTurn();
        });
      return;
    }

    const preparedTurn = state.preparedTurn;
    if (!state.prepared || !preparedTurn) {
      readerDiagnostic(
        'turn.commit.fallback',
        () =>
          `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} mounted=${String(state.prepared)} direction=${directionName(state.direction)}`,
      );
      this.publishInteractive(undefined);
      void (
        preparedTurn
          ? this.runtime.commitPreparedTurn(preparedTurn)
          : state.direction > 0
            ? this.runtime.next(state.performanceId)
            : this.runtime.previous(state.performanceId)
      ).then((result) => {
        readerDiagnostic(
          'turn.commit.fallback-ready',
          () => `turn=${state.id} result=${describeSnapshotIdentity(result)}`,
        );
        this.activeTurnId = undefined;
        this.values.releasePending.set(false);
        this.finishTurn();
      });
      return;
    }

    const navigate = this.runtime.commitPreparedTurn(preparedTurn);
    const settleDuration = pageTurnEffect.motion.getSettleDuration({ ...settleContext, targetProgress: 1 });
    const generation = ++this.handoffGeneration;
    const visualSettle = this.settleInteractive(state, 1, settleDuration, towardTargetVelocity, throwVelocity, false);
    this.travelDirection = state.direction;
    this.clearStockTokens();
    this.publish({ stocks: [] });
    readerDiagnostic(
      'turn.commit.begin',
      () =>
        `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)} durationMs=${settleDuration} generation=${generation}`,
    );
    void Promise.allSettled([navigate, visualSettle]).then(() => {
      if (this.handoffGeneration !== generation) return;
      const currentSnapshot = this.runtime.getSnapshot();
      if (
        currentSnapshot.revisionId !== preparedTurn.revisionId ||
        currentSnapshot.spreadIndex !== preparedTurn.targetSpreadIndex ||
        currentSnapshot.renderId !== preparedTurn.targetRenderId
      ) {
        readerDiagnostic(
          'turn.commit.mismatch',
          () =>
            `turn=${state.id} prepared=${preparedTurn.id} expected=${describePreparedTarget(preparedTurn)} runtime=${describeSnapshotIdentity(currentSnapshot)}`,
        );
        this.finishTurn();
        return;
      }
      readerDiagnostic(
        'turn.commit.runtime-ready',
        () =>
          `turn=${state.id} prepared=${preparedTurn.id} runtime=${describeSnapshotIdentity(currentSnapshot)} generation=${generation}`,
      );
      this.beginCommittedHandoff({
        performanceId: state.performanceId,
        turnId: state.id,
        generation,
        revisionId: preparedTurn.revisionId,
        spreadIndex: preparedTurn.targetSpreadIndex,
        renderId: preparedTurn.targetRenderId,
      });
    });
  }

  /** Publishes the release pose; resolves when the timing driver reports the end, or after a fallback delay. */
  private settleInteractive(
    state: ReaderDragState,
    settleTo: 0 | 1,
    settleDuration: number,
    releaseVelocity: number,
    throwVelocity: number,
    cancelled: boolean,
  ): Promise<void> {
    let notifyVisualSettle: () => void = () => undefined;
    const visualSettle = new Promise<void>((resolve) => {
      notifyVisualSettle = () => {
        readerPerformanceMark('reader.animation.settled', {
          workId: state.performanceId,
          turnId: state.id,
          cancelled,
        });
        resolve();
      };
    });
    readerPerformanceMark('reader.animation.release', {
      workId: state.performanceId,
      turnId: state.id,
      plannedDurationMs: settleDuration,
      cancelled,
    });
    this.updateInteractive((turn) => ({
      ...turn,
      progress: state.renderProgress,
      progressValue: this.values.progress,
      grabY: state.grabY,
      grabYValue: this.values.grabY,
      pressedEdgeX: state.pressedEdgeX,
      pressedEdgeXValue: this.values.pressedEdgeX,
      heldRollTilt: state.heldRollTilt,
      heldRollTiltValue: this.values.heldRollTilt,
      fingerX: state.fingerX,
      startBookX: state.startBookX,
      releaseVelocity,
      throwVelocity,
      settling: true,
      settleTo,
      onSettleComplete: notifyVisualSettle,
    }));
    return Promise.race([visualSettle, waitFor(settleDuration + PAGE_TURN_SETTLE_FALLBACK_DELAY_MS)]);
  }

  // Handoff to the subscriber.

  private beginCommittedHandoff(handoff: ReaderCommittedHandoff): void {
    this.committedHandoff = handoff;
    this.continueCommittedHandoff();
  }

  /**
   * Releases a committed turn only when the subscriber renders its target and
   * two more frames have reached the canvas; the runtime snapshot alone never
   * releases it.
   */
  private continueCommittedHandoff(): void {
    const handoff = this.committedHandoff;
    if (!handoff || handoff.waitingForFrames || this.handoffGeneration !== handoff.generation) return;
    const snapshot = this.subscriberSnapshot;
    if (
      snapshot.revisionId !== handoff.revisionId ||
      snapshot.spreadIndex !== handoff.spreadIndex ||
      snapshot.renderId !== handoff.renderId
    ) {
      return;
    }
    handoff.waitingForFrames = true;
    readerDiagnostic(
      'turn.handoff.snapshot-ready',
      () => `turn=${handoff.turnId} ui=${describeSnapshotIdentity(snapshot)} generation=${handoff.generation}`,
    );
    readerPerformanceMark('reader.handoff.snapshot', {
      workId: handoff.performanceId,
      page: describeSnapshotIdentity(snapshot),
    });
    void waitForPageHandoffFrames().then(() => {
      if (this.committedHandoff !== handoff || this.handoffGeneration !== handoff.generation) return;
      if (handoff.nativeTurnId) {
        acknowledgeNativePagerPresentationById(this.values.nativePagerId.value, handoff.nativeTurnId);
      }
      readerDiagnostic('turn.handoff.clear', () => `turn=${handoff.turnId} generation=${handoff.generation}`);
      readerPerformanceMark('reader.turn.complete', {
        workId: handoff.performanceId,
        turnId: handoff.turnId,
        mode: 'gesture',
      });
      this.finishTurn();
    });
  }

  /** Clears the finished input turn and lets queued input or idle preparation continue. */
  private finishTurn(): void {
    this.activeTurnId = undefined;
    this.committedHandoff = undefined;
    // Pairs leaving another page are spent. Those already refilled around the
    // page this turn revealed stay, so the next drag needs no idle wait.
    const snapshot = this.subscriberSnapshot;
    const current = this.store.getState().stocks;
    const kept = current.filter((stock) => sameSnapshotIdentity(stock.source.snapshot, snapshot));
    // Unchanged pairs keep their identity, so the surface does not resubmit them.
    const stocks = kept.length === current.length ? current : kept;
    for (const direction of [1, -1] as const) {
      const token = this.stockTokenFor(direction).value;
      if (!stocks.some((stock) => stock.direction === direction && stock.token === token)) {
        this.stockTokenFor(direction).set(0);
      }
    }
    this.publish({ interactiveTurn: undefined, stocks });
    const deferred = this.deferredTap;
    if (deferred) {
      this.deferredTap = undefined;
      void this.navigate(deferred.direction).then((snapshot) => {
        for (const resolve of deferred.resolvers) resolve(snapshot);
      });
      return;
    }
    this.scheduleIdleWork();
  }

  // Taps.

  private navigate(direction: 1 | -1): Promise<ReaderSnapshot> {
    if (this.disposed) return Promise.resolve(this.runtime.getSnapshot());
    this.travelDirection = direction;
    // A tap during a drag or a settling turn runs right after that turn
    // instead of tearing it down; the latest direction wins.
    if (this.drag || this.activeTurnId !== undefined) {
      const deferred = this.deferredTap ?? { direction, resolvers: [] };
      deferred.direction = direction;
      this.deferredTap = deferred;
      return new Promise((resolve) => deferred.resolvers.push(resolve));
    }
    return this.automatic.enqueue(direction);
  }

  private async prepareForAutomaticNavigation(): Promise<void> {
    if (this.activeTurnId === undefined && !this.drag) return;
    this.handoffGeneration += 1;
    const preparedTurn = this.drag?.preparedTurn;
    this.drag = undefined;
    this.activeTurnId = undefined;
    this.committedHandoff = undefined;
    this.publishInteractive(undefined);
    if (preparedTurn) await this.runtime.cancelPreparedTurn(preparedTurn);
  }

  // Runtime notifications.

  private readonly handleRuntimeSnapshot = (snapshot: ReaderSnapshot): void => {
    this.automatic.handleRuntimeSnapshot(snapshot);
  };

  // Idle preparation.

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private isIdle(snapshot: ReaderSnapshot): boolean {
    const state = this.store.getState();
    return (
      this.canPeekAround(snapshot) &&
      this.activeTurnId === undefined &&
      state.automaticTurns.length === 0 &&
      state.interactiveTurn === undefined
    );
  }

  /**
   * Whether the neighbors of `snapshot` may be peeked and stocked: it is the
   * page the subscriber shows and the runtime has settled on, and no drag or
   * queued navigation is about to leave it. A turn that revealed it may still
   * be animating.
   */
  private canPeekAround(snapshot: ReaderSnapshot): boolean {
    return (
      !this.disposed &&
      snapshot.phase === 'ready' &&
      !this.drag &&
      this.automatic.pending === 0 &&
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
   * pair already held by the composer, and the next tap finds its Picture
   * compiled, instead of both waiting for the turn to end and the reader to idle.
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
   * next drag either way from its first frame instead of waiting for that
   * drag to prepare its target. False when the page moved on first.
   */
  private stockPages(snapshot: ReaderSnapshot, pages: readonly ReaderAdjacentPage[]): boolean {
    if (!this.canPeekAround(snapshot)) return false;
    // Without a composer the peek only compiled the neighbors' Pictures.
    if (this.config.spreadMode !== 'single' || !this.config.pageTurnEffect.native) return true;
    const source = readerPageContentForSnapshot(this.runtime, snapshot);
    if (!source) return false;
    const previous = this.store.getState().stocks;
    const stocks: ReaderPageTurnStock[] = [];
    for (const page of pages) {
      const direction = page.direction === 'next' ? 1 : -1;
      const target: ReaderPageContent = {
        key: describeSnapshotIdentity(page.snapshot),
        snapshot: page.snapshot,
        picture: page.picture,
        frame: page.frame,
      };
      // The same pair keeps its token, so a stocked composer is not asked again.
      const kept = previous.find(
        (stock) => stock.direction === direction && stock.source.key === source.key && stock.target.key === target.key,
      );
      stocks.push(
        kept ?? {
          token: ++this.stockTokenSequence,
          preparedTurnId: 0,
          direction,
          source,
          target,
          performanceId: readerPerformanceId('stock'),
        },
      );
    }
    for (const direction of [1, -1] as const) {
      const token = stocks.find((stock) => stock.direction === direction)?.token;
      if (this.stockTokenFor(direction).value !== token) this.stockTokenFor(direction).set(0);
    }
    readerDiagnostic(
      'turn.stock.refill',
      () => `source=${source.key} ${stocks.map((stock) => `${stock.direction}->${stock.target.key}`).join(' ')}`,
    );
    this.publish({ stocks });
    return true;
  }

  /** The stocked pairs with a drag's own pair in place of any for its direction. */
  private stocksWithDragPair(stock: ReaderPageTurnStock | undefined): readonly ReaderPageTurnStock[] {
    const others = this.store.getState().stocks.filter((candidate) => candidate.direction !== stock?.direction);
    return stock ? [...others, stock] : others;
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
    return {
      token,
      preparedTurnId: preparedTurn.id,
      direction,
      source,
      target,
      performanceId: preparedTurn.performanceId,
    };
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

function peekKey(snapshot: ReaderSnapshot): string {
  return describeSnapshotIdentity(snapshot);
}

function shallowEqualState(left: ReaderPageTurnState, right: ReaderPageTurnState): boolean {
  return (
    left.interactiveTurn === right.interactiveTurn &&
    left.automaticTurns === right.automaticTurns &&
    left.automaticNavigationActive === right.automaticNavigationActive &&
    left.isSettling === right.isSettling &&
    left.stocks === right.stocks &&
    left.nativeResetEpoch === right.nativeResetEpoch
  );
}

function waitFor(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/** Allow the committed page to reach React's subscriber and the Skia canvas. */
function waitForPageHandoffFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
