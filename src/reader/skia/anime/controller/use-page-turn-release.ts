import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import { readerDiagnostic, readerPerformanceMark } from '../../../runtime/core/performance';
import { describePreparedTarget, describeSnapshotIdentity, formatTraceNumber } from '../core/page-content';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderInteractiveTurn } from '../core/page-turn-types';
import { planarTurnProgressForTranslation } from '../gesture/page-turn-gesture';
import type { PageTurnGestureValues } from '../gesture/use-page-turn-pan-gesture';
import type {
  ReaderCommittedHandoff,
  ReaderDragState,
  ReaderNativeGestureHandoff,
} from './interactive-page-turn-state';

const PAGE_TURN_SETTLE_FALLBACK_DELAY_MS = 180;

interface PageTurnReleaseOptions {
  readonly activeTurnIdRef: RefObject<number | undefined>;
  readonly animationDuration: number;
  readonly dragStateRef: RefObject<ReaderDragState | undefined>;
  readonly gestureValues: PageTurnGestureValues;
  readonly handoffGenerationRef: RefObject<number>;
  readonly nativeGestureHandoffRef: RefObject<Map<number, ReaderNativeGestureHandoff>>;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly runtime: LunarReaderRuntime;
  readonly setCommittedHandoff: Dispatch<SetStateAction<ReaderCommittedHandoff | undefined>>;
  readonly setInteractiveTurn: Dispatch<SetStateAction<ReaderInteractiveTurn | undefined>>;
  readonly spreadMode: ReaderSpreadMode;
  readonly viewport?: ReaderViewport;
}

export function usePageTurnRelease({
  activeTurnIdRef,
  animationDuration,
  dragStateRef,
  gestureValues,
  handoffGenerationRef,
  nativeGestureHandoffRef,
  pageTurnEffect,
  runtime,
  setCommittedHandoff,
  setInteractiveTurn,
  spreadMode,
  viewport,
}: PageTurnReleaseOptions): (releaseVelocity?: number, releaseTranslationX?: number, nativeReleased?: boolean) => void {
  const finishDrag = useCallback(
    (state: ReaderDragState, releaseVelocity = 0, releaseTranslationX = 0, nativeReleased = false) => {
      readerPerformanceMark('reader.gesture.release', {
        workId: state.performanceId,
        turnId: state.id,
        prepared: state.prepared,
        nativeReleased,
      });
      if (dragStateRef.current === state) dragStateRef.current = undefined;
      if (!nativeReleased && nativeGestureHandoffRef.current.has(state.nativeGestureToken)) {
        nativeGestureHandoffRef.current.delete(state.nativeGestureToken);
      }
      if (!state.directionLocked) {
        readerDiagnostic('turn.gesture.end', () => `turn=${state.id} decision=none reason=direction-unlocked`);
        activeTurnIdRef.current = undefined;
        gestureValues.releasePending.set(false);
        setInteractiveTurn(undefined);
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

      const terminalThrowVelocity = viewport
        ? Math.max(0, (state.direction === 1 ? -releaseVelocity : releaseVelocity) / Math.max(1, viewport.width))
        : 0;
      const throwVelocity = Math.max(state.throwVelocity, terminalThrowVelocity);
      const towardTargetVelocity = viewport
        ? (state.direction === 1 ? -releaseVelocity : releaseVelocity) / Math.max(1, viewport.width)
        : 0;
      const commit = pageTurnEffect.gesture.shouldCommit({
        progress: state.renderProgress,
        towardTargetVelocity,
        direction: state.direction,
        spreadMode,
        startBookX: state.startBookX,
        fingerX: state.fingerX,
        throwVelocity,
        throwAcceleration: state.throwAcceleration,
      });
      readerDiagnostic('turn.release', () =>
        [
          `turn=${state.id}`,
          `direction=${state.direction > 0 ? 'next' : 'previous'}`,
          `decision=${commit ? 'commit' : 'cancel'}`,
          `physicalProgress=${formatTraceNumber(state.physicalProgress)}`,
          `renderProgress=${formatTraceNumber(state.renderProgress)}`,
          `velocity=${formatTraceNumber(towardTargetVelocity)}`,
          `prepared=${String(state.prepared)}`,
          `preparedId=${state.preparedTurn?.id ?? 'none'}`,
        ].join(' '),
      );
      if (nativeReleased && state.preparedTurn && state.prepared) {
        const existingHandoff = nativeGestureHandoffRef.current.get(state.nativeGestureToken);
        const generation = existingHandoff ? existingHandoff.generation : ++handoffGenerationRef.current;
        if (!existingHandoff) {
          nativeGestureHandoffRef.current.set(state.nativeGestureToken, {
            turnId: state.id,
            gestureToken: state.nativeGestureToken,
            preparedTurn: state.preparedTurn,
            generation,
            terminalEventHandled: false,
          });
        }
        setInteractiveTurn((turn) =>
          turn
            ? {
                ...turn,
                progress: state.renderProgress,
                progressValue: gestureValues.progress,
                pressedEdgeX: state.pressedEdgeX,
                heldRollTilt: state.heldRollTilt,
                fingerX: state.fingerX,
                startBookX: state.startBookX,
                releaseVelocity: towardTargetVelocity,
                throwVelocity,
                settling: true,
                settleTo: commit ? 1 : 0,
                nativeGesture: turn.nativeGesture
                  ? {
                      ...turn.nativeGesture,
                      driven: true,
                      settling: true,
                    }
                  : undefined,
              }
            : turn,
        );
        readerDiagnostic(
          'turn.native.release',
          () =>
            `turn=${state.id} prepared=${state.preparedTurn?.id} expected=${commit ? 'commit' : 'cancel'} generation=${generation}`,
        );
        return;
      }
      if (!commit) {
        if (!state.prepared) {
          if (state.preparedTurn) void runtime.cancelPreparedTurn(state.preparedTurn);
          readerDiagnostic(
            'turn.cancel.clear',
            () => `turn=${state.id} mode=without-mounted-target prepared=${state.preparedTurn?.id ?? 'none'}`,
          );
          activeTurnIdRef.current = undefined;
          gestureValues.releasePending.set(false);
          setInteractiveTurn(undefined);
          return;
        }
        const settleDuration = pageTurnEffect.motion.getSettleDuration({
          fromProgress: state.renderProgress,
          targetProgress: 0,
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
        });
        const generation = ++handoffGenerationRef.current;
        const preparedTurn = state.preparedTurn;
        let notifyVisualSettle: () => void = () => undefined;
        const visualSettle = new Promise<void>((resolve) => {
          notifyVisualSettle = () => {
            readerPerformanceMark('reader.animation.settled', { workId: state.performanceId, cancelled: true });
            resolve();
          };
        });
        readerPerformanceMark('reader.animation.release', {
          workId: state.performanceId,
          plannedDurationMs: settleDuration,
          cancelled: true,
        });
        readerDiagnostic(
          'turn.cancel.begin',
          () => `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} durationMs=${settleDuration}`,
        );
        setInteractiveTurn((turn) =>
          turn
            ? {
                ...turn,
                progress: state.renderProgress,
                progressValue: gestureValues.progress,
                grabY: state.grabY,
                grabYValue: gestureValues.grabY,
                pressedEdgeX: state.pressedEdgeX,
                pressedEdgeXValue: gestureValues.pressedEdgeX,
                heldRollTilt: state.heldRollTilt,
                heldRollTiltValue: gestureValues.heldRollTilt,
                startBookX: state.startBookX,
                releaseVelocity: towardTargetVelocity,
                settling: true,
                settleTo: 0,
                onSettleComplete: notifyVisualSettle,
              }
            : turn,
        );
        void Promise.race([visualSettle, waitForPageTurn(settleDuration + PAGE_TURN_SETTLE_FALLBACK_DELAY_MS)])
          .then(() => {
            readerDiagnostic(
              'turn.cancel.visual-ready',
              () => `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} generation=${generation}`,
            );
            return preparedTurn ? runtime.cancelPreparedTurn(preparedTurn) : Promise.resolve();
          })
          .catch(() => undefined)
          .then(waitForPageHandoffFrames)
          .then(() => {
            if (handoffGenerationRef.current !== generation) return;
            readerDiagnostic(
              'turn.cancel.clear',
              () =>
                `turn=${state.id} runtime=${describeSnapshotIdentity(runtime.getSnapshot())} generation=${generation}`,
            );
            activeTurnIdRef.current = undefined;
            readerPerformanceMark('reader.turn.complete', {
              workId: state.performanceId,
              cancelled: true,
              mode: 'gesture',
            });
            setInteractiveTurn(undefined);
          });
        return;
      }

      const preparedTurn = state.preparedTurn;
      if (!state.prepared || !preparedTurn) {
        readerDiagnostic(
          'turn.commit.fallback',
          () =>
            `turn=${state.id} prepared=${preparedTurn?.id ?? 'none'} mounted=${String(state.prepared)} direction=${state.direction > 0 ? 'next' : 'previous'}`,
        );
        setInteractiveTurn(undefined);
        void (
          preparedTurn
            ? runtime.commitPreparedTurn(preparedTurn)
            : state.direction > 0
              ? runtime.next(state.performanceId)
              : runtime.previous(state.performanceId)
        ).then((result) => {
          readerDiagnostic(
            'turn.commit.fallback-ready',
            () => `turn=${state.id} result=${describeSnapshotIdentity(result)}`,
          );
          activeTurnIdRef.current = undefined;
          gestureValues.releasePending.set(false);
        });
        return;
      }

      const navigate = runtime.commitPreparedTurn(preparedTurn);
      const settleDuration = pageTurnEffect.motion.getSettleDuration({
        fromProgress: state.renderProgress,
        targetProgress: 1,
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
      });
      const generation = ++handoffGenerationRef.current;
      let notifyVisualSettle: () => void = () => undefined;
      const visualSettle = new Promise<void>((resolve) => {
        notifyVisualSettle = () => {
          readerPerformanceMark('reader.animation.settled', { workId: state.performanceId, turnId: state.id });
          resolve();
        };
      });
      readerPerformanceMark('reader.animation.release', {
        workId: state.performanceId,
        turnId: state.id,
        plannedDurationMs: settleDuration,
      });
      setInteractiveTurn((turn) =>
        turn
          ? {
              ...turn,
              progress: state.renderProgress,
              progressValue: gestureValues.progress,
              pressedEdgeX: state.pressedEdgeX,
              heldRollTilt: state.heldRollTilt,
              fingerX: state.fingerX,
              startBookX: state.startBookX,
              releaseVelocity: towardTargetVelocity,
              throwVelocity,
              settling: true,
              settleTo: 1,
              onSettleComplete: notifyVisualSettle,
            }
          : turn,
      );
      readerDiagnostic(
        'turn.commit.begin',
        () =>
          `turn=${state.id} prepared=${preparedTurn.id} target=${describePreparedTarget(preparedTurn)} durationMs=${settleDuration} generation=${generation}`,
      );
      void Promise.allSettled([
        navigate,
        Promise.race([visualSettle, waitForPageTurn(settleDuration + PAGE_TURN_SETTLE_FALLBACK_DELAY_MS)]),
      ]).then(() => {
        if (handoffGenerationRef.current !== generation) return;
        const currentSnapshot = runtime.getSnapshot();
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
          activeTurnIdRef.current = undefined;
          setInteractiveTurn(undefined);
          return;
        }
        readerDiagnostic(
          'turn.commit.runtime-ready',
          () =>
            `turn=${state.id} prepared=${preparedTurn.id} runtime=${describeSnapshotIdentity(currentSnapshot)} generation=${generation}`,
        );
        setCommittedHandoff({
          performanceId: state.performanceId,
          turnId: state.id,
          generation,
          revisionId: preparedTurn.revisionId,
          spreadIndex: preparedTurn.targetSpreadIndex,
          renderId: preparedTurn.targetRenderId,
        });
      });
    },
    [
      activeTurnIdRef,
      animationDuration,
      dragStateRef,
      gestureValues,
      handoffGenerationRef,
      nativeGestureHandoffRef,
      pageTurnEffect,
      runtime,
      setCommittedHandoff,
      setInteractiveTurn,
      spreadMode,
      viewport,
    ],
  );

  return useCallback(
    (releaseVelocity = 0, releaseTranslationX = 0, nativeReleased = false) => {
      const state = dragStateRef.current;
      if (!state) {
        gestureValues.releasePending.set(false);
        return;
      }
      if (state.preparation && !state.preparedTurn) {
        readerPerformanceMark('reader.gesture.wait-prepare', { workId: state.performanceId });
        const preparation = state.preparation;
        readerDiagnostic(
          'turn.release.wait-prepare',
          () =>
            `turn=${state.id} translationX=${formatTraceNumber(releaseTranslationX)} velocityX=${formatTraceNumber(releaseVelocity)}`,
        );
        void preparation.then(() => {
          if (dragStateRef.current === state) {
            finishDrag(state, releaseVelocity, releaseTranslationX, nativeReleased);
          }
        });
        return;
      }
      finishDrag(state, releaseVelocity, releaseTranslationX, nativeReleased);
    },
    [dragStateRef, finishDrag, gestureValues.releasePending],
  );
}

function waitForPageTurn(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function waitForPageHandoffFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
