import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PanGesture } from 'react-native-gesture-handler';

import type { ReaderSnapshot, ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { LunarReaderRuntime, ReaderPreparedTurn } from '../../../runtime/core/native-reader-runtime';
import { readerDiagnostic, readerPerformanceId, readerPerformanceMark } from '../../../runtime/core/performance';
import { acknowledgeNativePagerPresentationById, type NativePagerEventRecord } from '../native/pager-compositor';
import { readerInteractivePageTurnIdentity } from '../native/page-turn';
import {
  planarTurnProgressForTranslation,
  throwAccelerationForRelease,
  trackThrowVelocity,
} from '../gesture/page-turn-gesture';
import {
  describePreparedTarget,
  describeSnapshotIdentity,
  formatTraceNumber,
  readerPageContentForSnapshot,
  sameSnapshotIdentity,
} from '../core/page-content';
import type { ReaderInteractiveTurn, ReaderPageContent } from '../core/page-turn-types';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderPageTurnSurfaceBinding } from '../native/page-turn-binding';
import { usePageTurnGestureValues, usePageTurnPanGesture } from '../gesture/use-page-turn-pan-gesture';
import type {
  ReaderCommittedHandoff,
  ReaderDragState,
  ReaderNativeGestureHandoff,
} from './interactive-page-turn-state';
import { usePageTurnRelease } from './use-page-turn-release';

interface InteractivePageTurnOptions {
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly viewport?: ReaderViewport;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly animationDuration: number;
  readonly spreadMode: ReaderSpreadMode;
  readonly automaticNavigationActive: boolean;
  /** Vertical viewport offset of the reader surface, used with absolute gesture coordinates. */
  readonly surfaceTop: number;
}

interface InteractivePageTurnController {
  readonly gesture: PanGesture;
  readonly interactiveTurn?: ReaderInteractiveTurn;
  readonly isSettling: boolean;
  readonly surfaceBinding: ReaderPageTurnSurfaceBinding;
  readonly prepareForAutomaticNavigation: () => Promise<void>;
}

export function useInteractivePageTurn({
  runtime,
  snapshot,
  viewport,
  pageTurnEffect,
  animationDuration,
  spreadMode,
  automaticNavigationActive,
  surfaceTop,
}: InteractivePageTurnOptions): InteractivePageTurnController {
  const dragState = useRef<ReaderDragState | undefined>(undefined);
  const turnSequence = useRef(0);
  const activeTurnId = useRef<number | undefined>(undefined);
  const handoffGeneration = useRef(0);
  const nativeGestureHandoffs = useRef(new Map<number, ReaderNativeGestureHandoff>());
  const gestureValues = usePageTurnGestureValues();
  const {
    releasePending,
    grabY: gestureGrabY,
    heldRollTilt: gestureHeldRollTilt,
    nativeInputReady: nativePagerInputReady,
    nativePagerId,
    nativeStockedToken: nativeStockedGestureToken,
    pressedEdgeX: gesturePressedEdgeX,
    progress: gestureProgress,
  } = gestureValues;
  const [interactiveTurn, setInteractiveTurn] = useState<ReaderInteractiveTurn>();
  const [committedHandoff, setCommittedHandoff] = useState<ReaderCommittedHandoff>();
  const isReady = snapshot.phase === 'ready';
  const uiSnapshotIdentity = describeSnapshotIdentity(snapshot);
  const consumedTargetReady =
    interactiveTurn?.nativeGesture?.consumed === true &&
    interactiveTurn.content !== undefined &&
    sameSnapshotIdentity(snapshot, interactiveTurn.content.snapshot);
  const isSettling =
    !consumedTargetReady &&
    (interactiveTurn?.settling === true ||
      interactiveTurn?.nativeGesture?.settling === true ||
      interactiveTurn?.nativeGesture?.consumed === true);

  useEffect(() => {
    if ((consumedTargetReady && !dragState.current) || activeTurnId.current === undefined) {
      gestureValues.releasePending.set(false);
    }
  });

  useEffect(() => {
    if (!isReady || interactiveTurn || automaticNavigationActive) return;
    const revisionId = snapshot.revisionId;
    const spreadIndex = snapshot.spreadIndex;
    const timer = setTimeout(() => {
      if (
        dragState.current ||
        runtime.getSnapshot().revisionId !== revisionId ||
        runtime.getSnapshot().spreadIndex !== spreadIndex
      )
        return;
      void runtime.warmAdjacentPictures(revisionId, spreadIndex).catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [automaticNavigationActive, interactiveTurn, isReady, runtime, snapshot.revisionId, snapshot.spreadIndex]);

  const prepareForAutomaticNavigation = useCallback(async () => {
    handoffGeneration.current += 1;
    const preparedTurn = dragState.current?.preparedTurn;
    dragState.current = undefined;
    activeTurnId.current = undefined;
    setCommittedHandoff(undefined);
    setInteractiveTurn(undefined);
    if (preparedTurn) await runtime.cancelPreparedTurn(preparedTurn);
  }, [runtime]);
  useEffect(() => {
    if (!committedHandoff) return;
    if (handoffGeneration.current !== committedHandoff.generation) return;
    if (
      snapshot.revisionId !== committedHandoff.revisionId ||
      snapshot.spreadIndex !== committedHandoff.spreadIndex ||
      snapshot.renderId !== committedHandoff.renderId
    ) {
      return;
    }

    readerDiagnostic(
      'turn.handoff.snapshot-ready',
      () => `turn=${committedHandoff.turnId} ui=${uiSnapshotIdentity} generation=${committedHandoff.generation}`,
    );
    let cancelled = false;
    readerPerformanceMark('reader.handoff.snapshot', {
      workId: committedHandoff.performanceId,
      page: uiSnapshotIdentity,
    });
    void waitForPageHandoffFrames().then(() => {
      if (cancelled || handoffGeneration.current !== committedHandoff.generation) return;
      if (committedHandoff.nativeTurnId) {
        acknowledgeNativePagerPresentationById(nativePagerId.value, committedHandoff.nativeTurnId);
      }
      readerDiagnostic(
        'turn.handoff.clear',
        () => `turn=${committedHandoff.turnId} ui=${uiSnapshotIdentity} generation=${committedHandoff.generation}`,
      );
      activeTurnId.current = undefined;
      readerPerformanceMark('reader.turn.complete', {
        workId: committedHandoff.performanceId,
        turnId: committedHandoff.turnId,
        mode: 'gesture',
      });
      setCommittedHandoff(undefined);
      setInteractiveTurn(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [
    committedHandoff,
    nativePagerId,
    snapshot.renderId,
    snapshot.revisionId,
    snapshot.spreadIndex,
    uiSnapshotIdentity,
  ]);

  useEffect(() => {
    if (!interactiveTurn && !committedHandoff) return;
    readerDiagnostic('turn.ui.snapshot', () =>
      [
        `turn=${committedHandoff?.turnId ?? activeTurnId.current ?? 'none'}`,
        `ui=${uiSnapshotIdentity}`,
        `target=${interactiveTurn?.content ? describeSnapshotIdentity(interactiveTurn.content.snapshot) : 'pending'}`,
        `settling=${String(interactiveTurn?.settling === true)}`,
        `handoff=${String(Boolean(committedHandoff))}`,
      ].join(' '),
    );
  }, [
    committedHandoff,
    interactiveTurn,
    snapshot.renderId,
    snapshot.revisionId,
    snapshot.spreadIndex,
    uiSnapshotIdentity,
  ]);

  const beginDrag = useCallback(
    (startX: number, startY: number, nativeToken: number) => {
      if (!isReady || !viewport || isSettling || automaticNavigationActive) return;
      if (!sameSnapshotIdentity(snapshot, runtime.getSnapshot())) return;
      const source = readerPageContentForSnapshot(runtime, snapshot);
      if (!source) return;
      const turnId = ++turnSequence.current;
      activeTurnId.current = turnId;
      handoffGeneration.current += 1;
      dragState.current = {
        performanceId: readerPerformanceId('gesture'),
        id: turnId,
        nativeGestureToken: nativeToken,
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
        workId: dragState.current.performanceId,
        turnId,
        token: nativeToken,
        effect: pageTurnEffect.visual.kind,
      });
      readerDiagnostic(
        'turn.gesture.begin',
        () =>
          `turn=${turnId} source=${describeSnapshotIdentity(snapshot)} x=${formatTraceNumber(startX)} y=${formatTraceNumber(startY)}`,
      );
    },
    [automaticNavigationActive, isSettling, isReady, pageTurnEffect.visual.kind, runtime, snapshot, viewport],
  );

  const showPreparedTurn = useCallback(
    (state: ReaderDragState, preparedTurn: ReaderPreparedTurn): boolean => {
      if (runtime.getSnapshot().revisionId !== preparedTurn.revisionId) {
        readerDiagnostic(
          'turn.target.reject',
          () =>
            `turn=${state.id} prepared=${preparedTurn.id} reason=revision runtime=${describeSnapshotIdentity(runtime.getSnapshot())} expectedRevision=${preparedTurn.revisionId}`,
        );
        return false;
      }
      state.preparedTurn = preparedTurn;
      const targetPicture = runtime.getCurrentPicture(
        preparedTurn.revisionId,
        preparedTurn.targetSpreadIndex,
        preparedTurn.targetRenderId,
      );
      const targetFrame = runtime.getCurrentFrame(preparedTurn.targetSpreadIndex);
      if (!targetPicture || !targetFrame) {
        if (!state.targetUnavailableLogged) {
          state.targetUnavailableLogged = true;
          readerDiagnostic(
            'turn.target.unavailable',
            () =>
              `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)} picture=${String(Boolean(targetPicture))} frame=${String(Boolean(targetFrame))}`,
          );
        }
        return false;
      }
      state.preparing = false;
      state.prepared = true;
      readerDiagnostic(
        'turn.target.mount',
        () =>
          `turn=${state.id} prepared=${preparedTurn.id} sourceSpread=${preparedTurn.sourceSnapshotSpreadIndex} target=${describePreparedTarget(preparedTurn)} progress=${formatTraceNumber(state.renderProgress)}`,
      );
      setInteractiveTurn({
        performanceId: state.performanceId,
        source: state.source,
        content: {
          key: describePreparedTarget(preparedTurn),
          snapshot: {
            ...snapshot,
            spreadIndex: preparedTurn.targetSpreadIndex,
            renderId: preparedTurn.targetRenderId,
          },
          picture: targetPicture,
          frame: targetFrame,
        } satisfies ReaderPageContent,
        direction: state.direction,
        progress: state.renderProgress,
        progressValue: gestureProgress,
        grabX: state.grabX,
        grabY: state.grabY,
        grabYValue: gestureGrabY,
        pressedEdgeX: state.pressedEdgeX,
        pressedEdgeXValue: gesturePressedEdgeX,
        heldRollTilt: state.heldRollTilt,
        heldRollTiltValue: gestureHeldRollTilt,
        fingerX: state.fingerX,
        startBookX: state.startBookX,
        throwVelocity: state.throwVelocity,
        throwAcceleration: state.throwAcceleration,
        nativeGesture: {
          token: state.nativeGestureToken,
          preparedTurnId: preparedTurn.id,
          driven: false,
          settling: false,
          consumed: false,
        },
      });
      return true;
    },
    [gestureGrabY, gestureHeldRollTilt, gesturePressedEdgeX, gestureProgress, runtime, snapshot],
  );

  const updateDrag = useCallback(
    (translationX: number, absoluteY: number, velocityX: number) => {
      const state = dragState.current;
      if (!state || !viewport || !isReady) return;
      if (!state.directionLocked) {
        if (Math.abs(translationX) < 2) return;
        state.direction = translationX < 0 ? 1 : -1;
        state.directionLocked = true;
        readerDiagnostic(
          'turn.gesture.direction',
          () =>
            `turn=${state.id} direction=${state.direction > 0 ? 'next' : 'previous'} translationX=${formatTraceNumber(translationX)}`,
        );
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
      state.throwAcceleration = throwAccelerationForRelease(state.throwVelocity, velocityX, direction, viewport.width);
      state.throwVelocity = trackThrowVelocity(state.throwVelocity, velocityX, direction, viewport.width);
      state.grabY = Math.min(viewport.height, Math.max(0, absoluteY - surfaceTop));

      if (!state.pendingPublished && pageTurnEffect.visual.kind === 'slide') {
        state.pendingPublished = true;
        setInteractiveTurn({
          performanceId: state.performanceId,
          source: state.source,
          direction,
          progress: state.renderProgress,
          progressValue: gestureProgress,
          grabX: state.grabX,
          grabY: state.grabY,
          grabYValue: gestureGrabY,
        });
      }

      if (state.preparedTurn && !state.prepared) {
        showPreparedTurn(state, state.preparedTurn);
        return;
      }

      if (!state.preparing && !state.prepared) {
        state.preparing = true;
        const turnDirection = direction > 0 ? 'next' : 'previous';
        readerDiagnostic(
          'turn.prepare.begin',
          () =>
            `turn=${state.id} direction=${turnDirection} sourceRevision=${state.revisionId} sourceSpread=${state.startSpread}`,
        );
        const preparation = runtime.prepareAdjacent(turnDirection, state.performanceId);
        state.preparation = preparation;
        void preparation.then((preparedTurn) => {
          const current = dragState.current;
          if (
            !current ||
            current !== state ||
            current.revisionId !== state.revisionId ||
            current.direction !== direction ||
            runtime.getSnapshot().revisionId !== state.revisionId
          ) {
            readerDiagnostic(
              'turn.prepare.stale',
              () =>
                `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} activeTurn=${current?.id ?? 'none'} runtime=${describeSnapshotIdentity(runtime.getSnapshot())}`,
            );
            if (preparedTurn) void runtime.cancelPreparedTurn(preparedTurn);
            return;
          }
          current.preparation = undefined;
          if (preparedTurn) current.preparedTurn = preparedTurn;
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
              : `turn=${state.id} direction=${turnDirection} runtime=${describeSnapshotIdentity(runtime.getSnapshot())}`,
          );
          if (!preparedTurn || !showPreparedTurn(current, preparedTurn)) {
            current.preparing = false;
          }
        });
      }
    },
    [
      isReady,
      gestureGrabY,
      gestureProgress,
      pageTurnEffect,
      runtime,
      showPreparedTurn,
      spreadMode,
      surfaceTop,
      viewport,
    ],
  );

  const markNativeGestureAccepted = useCallback((nativeToken: number) => {
    const state = dragState.current;
    if (!state || state.nativeGestureToken !== nativeToken || !state.preparedTurn || !state.prepared) {
      return;
    }
    const preparedTurn = state.preparedTurn;
    const existingHandoff = nativeGestureHandoffs.current.get(nativeToken);
    if (!existingHandoff) {
      nativeGestureHandoffs.current.set(nativeToken, {
        turnId: state.id,
        gestureToken: nativeToken,
        preparedTurn,
        generation: ++handoffGeneration.current,
        terminalEventHandled: false,
      });
    }
    setInteractiveTurn((turn) =>
      turn?.nativeGesture?.token === nativeToken
        ? {
            ...turn,
            nativeGesture: {
              ...turn.nativeGesture,
              driven: true,
            },
          }
        : turn,
    );
  }, []);

  const handleNativeGestureEvent = useCallback(
    (event: NativePagerEventRecord) => {
      const identity = readerInteractivePageTurnIdentity(event.id);
      if (!identity) return;
      const handoff = nativeGestureHandoffs.current.get(identity.gestureToken);
      if (
        !handoff ||
        handoff.gestureToken !== identity.gestureToken ||
        handoff.preparedTurn.id !== identity.preparedTurnId
      ) {
        return;
      }
      readerDiagnostic(
        'turn.native.event',
        () =>
          `turn=${identity.gestureToken} prepared=${identity.preparedTurnId} event=${event.event} native=${event.id}`,
      );
      if (event.event === 'consumed' && !handoff.commit) {
        setInteractiveTurn((turn) =>
          turn?.nativeGesture?.token === identity.gestureToken
            ? {
                ...turn,
                settling: false,
                nativeGesture: {
                  ...turn.nativeGesture,
                  consumed: true,
                  settling: false,
                },
              }
            : turn,
        );
        handoff.commit = runtime.commitPreparedTurn(handoff.preparedTurn);
        return;
      }
      if (handoff.terminalEventHandled || (event.event !== 'completed' && event.event !== 'cancelled')) {
        return;
      }
      handoff.terminalEventHandled = true;
      if (event.event === 'cancelled') {
        void runtime
          .cancelPreparedTurn(handoff.preparedTurn)
          .catch(() => undefined)
          .then(waitForPageHandoffFrames)
          .then(() => {
            if (nativeGestureHandoffs.current.get(identity.gestureToken) !== handoff) return;
            nativeGestureHandoffs.current.delete(identity.gestureToken);
            if (activeTurnId.current !== handoff.turnId) return;
            activeTurnId.current = undefined;
            setInteractiveTurn(undefined);
          });
        return;
      }

      const commit = handoff.commit ?? runtime.commitPreparedTurn(handoff.preparedTurn);
      handoff.commit = commit;
      void commit
        .then((result) => {
          if (nativeGestureHandoffs.current.get(identity.gestureToken) !== handoff) return;
          const preparedTurn = handoff.preparedTurn;
          if (
            result.revisionId !== preparedTurn.revisionId ||
            result.spreadIndex !== preparedTurn.targetSpreadIndex ||
            result.renderId !== preparedTurn.targetRenderId
          ) {
            nativeGestureHandoffs.current.delete(identity.gestureToken);
            if (activeTurnId.current === handoff.turnId) {
              activeTurnId.current = undefined;
              setInteractiveTurn(undefined);
            }
            return;
          }
          nativeGestureHandoffs.current.delete(identity.gestureToken);
          if (activeTurnId.current !== handoff.turnId) {
            acknowledgeNativePagerPresentationById(nativePagerId.value, event.id);
            return;
          }
          setCommittedHandoff({
            performanceId: preparedTurn.performanceId,
            turnId: handoff.turnId,
            generation: handoff.generation,
            revisionId: preparedTurn.revisionId,
            spreadIndex: preparedTurn.targetSpreadIndex,
            renderId: preparedTurn.targetRenderId,
            nativeTurnId: event.id,
          });
        })
        .catch(() => {
          if (nativeGestureHandoffs.current.get(identity.gestureToken) !== handoff) return;
          nativeGestureHandoffs.current.delete(identity.gestureToken);
          if (activeTurnId.current !== handoff.turnId) return;
          activeTurnId.current = undefined;
          setInteractiveTurn(undefined);
        });
    },
    [nativePagerId, runtime],
  );

  const endDrag = usePageTurnRelease({
    activeTurnIdRef: activeTurnId,
    animationDuration,
    dragStateRef: dragState,
    gestureValues,
    handoffGenerationRef: handoffGeneration,
    nativeGestureHandoffRef: nativeGestureHandoffs,
    pageTurnEffect,
    runtime,
    setCommittedHandoff,
    setInteractiveTurn,
    spreadMode,
    viewport,
  });

  const gesture = usePageTurnPanGesture({
    automaticNavigationActive,
    beginDrag,
    endDrag,
    isSettling,
    markNativeGestureAccepted,
    pageTurnEffect,
    spreadMode,
    surfaceTop,
    updateDrag,
    values: gestureValues,
    viewport,
  });

  const surfaceBinding = useMemo<ReaderPageTurnSurfaceBinding>(
    () => ({
      nativeId: nativePagerId,
      inputReady: nativePagerInputReady,
      stockedGestureToken: nativeStockedGestureToken,
      onNativeEvent: handleNativeGestureEvent,
    }),
    [handleNativeGestureEvent, nativePagerId, nativePagerInputReady, nativeStockedGestureToken],
  );

  useEffect(() => {
    const handoffs = nativeGestureHandoffs.current;
    handoffs.clear();
    nativeStockedGestureToken.set(0);
    return () => {
      handoffGeneration.current += 1;
      handoffs.clear();
      nativePagerInputReady.set(false);
      nativeStockedGestureToken.set(0);
      const preparedTurn = dragState.current?.preparedTurn;
      dragState.current = undefined;
      releasePending.set(false);
      if (preparedTurn) void runtime.cancelPreparedTurn(preparedTurn);
    };
  }, [nativePagerInputReady, nativeStockedGestureToken, releasePending, runtime]);

  return {
    gesture,
    interactiveTurn,
    isSettling,
    surfaceBinding,
    prepareForAutomaticNavigation,
  };
}

/** Allow the committed page to reach React's subscriber and the Skia canvas. */
function waitForPageHandoffFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
