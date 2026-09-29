import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ReaderSpreadMode } from '../../../contracts';
import { useReaderPageTurnVisuals } from '../effects/use-page-turn-visuals';
import { automaticPageTurnTransition } from '../core/page-turn-concurrency';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type {
  ReaderAutomaticTurn,
  ReaderInteractiveTurn,
  ReaderPageContent,
  ReaderPageTransitionState,
  ReaderPageTransitionValues,
} from '../core/page-turn-types';

interface ReaderPageIdentity {
  readonly revisionId: number;
  readonly spreadIndex: number;
  readonly renderId?: number;
}

export function useReaderPageTransition(
  current: ReaderPageContent | undefined,
  pageTurnEffect: ReaderPageTurnEffect,
  animationDuration = 360,
  interactiveTurn?: ReaderInteractiveTurn,
  spreadMode: ReaderSpreadMode = 'double',
  automaticTurn?: ReaderAutomaticTurn,
  automaticTurnCount = 0,
  suppressAutomaticTransition = false,
  onAutomaticTurnComplete?: (turnId: number) => void,
  nativeAutomaticTurnDriven = false,
): ReaderPageTransitionValues {
  const [displayedContent, setDisplayedContent] = useState<ReaderPageContent>();
  const [interactiveCommit, setInteractiveCommit] = useState<ReaderPageIdentity>();
  const [transition, setTransition] = useState<ReaderPageTransitionState>();
  const animatedAutomaticTurnId = useRef<number | undefined>(undefined);
  const progress = useSharedValue(1);
  const animatedProgress = interactiveTurn?.progressValue ?? progress;
  const currentKey = current?.key;
  const interactiveContent = interactiveTurn?.content;
  const interactiveSource = interactiveTurn?.source ?? displayedContent;
  const interactiveDirection = interactiveTurn?.direction;
  const hasInteractiveTurn = interactiveTurn !== undefined;
  const interactiveTargetSpread = interactiveContent?.snapshot.spreadIndex;
  const interactiveTransition = useMemo<ReaderPageTransitionState | undefined>(
    () =>
      hasInteractiveTurn && interactiveSource
        ? {
            from: interactiveSource,
            toKey: interactiveContent?.key ?? `pending:${interactiveDirection}:${interactiveSource.key}`,
            direction:
              interactiveDirection ??
              ((interactiveTargetSpread ?? interactiveSource.snapshot.spreadIndex) >
              interactiveSource.snapshot.spreadIndex
                ? 1
                : -1),
          }
        : undefined,
    [interactiveSource, hasInteractiveTurn, interactiveContent, interactiveTargetSpread, interactiveDirection],
  );
  const automaticTransition = useMemo(() => {
    if (!automaticTurn || nativeAutomaticTurnDriven || !pageTurnEffect.orchestration.usesPlanarAutomaticTransition) {
      return undefined;
    }
    const next = automaticPageTurnTransition(automaticTurn);
    return displayedContent?.key === next.from.key ? { ...next, from: displayedContent } : next;
  }, [automaticTurn, displayedContent, nativeAutomaticTurnDriven, pageTurnEffect]);
  const activeTransition =
    interactiveTransition ??
    automaticTransition ??
    (!nativeAutomaticTurnDriven && transition?.toKey === currentKey ? transition : undefined);
  const visibleContent =
    interactiveContent ??
    (automaticTransition ? automaticTurn?.to : undefined) ??
    (activeTransition ? current : (displayedContent ?? current));
  const incomingPageLanding = activeTransition
    ? pageTurnEffect.visual.isIncomingPageLanding(activeTransition.direction, spreadMode)
    : false;
  const clearTransition = useCallback((key: string) => {
    setTransition((value) => (value?.toKey === key ? undefined : value));
  }, []);
  const direction = activeTransition?.direction ?? 1;
  const transitionFrame =
    interactiveContent?.frame ?? automaticTurn?.to.frame ?? current?.frame ?? displayedContent?.frame;
  const width = transitionFrame?.width ?? 0;
  const height = transitionFrame?.height ?? 0;
  const grabX = interactiveTurn?.grabX ?? (direction > 0 ? 0 : width);
  const grabY = interactiveTurn?.grabY ?? height / 2;
  const visualValues = useReaderPageTurnVisuals(pageTurnEffect, direction, width, animatedProgress);
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (interactiveTurn) {
      if (!interactiveTurn.content) return;
      const targetIdentity: ReaderPageIdentity = {
        revisionId: interactiveTurn.content.snapshot.revisionId,
        spreadIndex: interactiveTurn.content.snapshot.spreadIndex,
        renderId: interactiveTurn.content.snapshot.renderId,
      };
      if (!samePageIdentity(targetIdentity, interactiveCommit)) {
        setInteractiveCommit(targetIdentity);
      }
      if (
        interactiveTurn.nativeGesture?.consumed &&
        current &&
        samePageIdentity(current.snapshot, targetIdentity) &&
        current.key !== displayedContent?.key
      ) {
        setDisplayedContent(current);
      }
      // During release the timing driver owns the shared value. Writing the
      // last React gesture sample here would jump the curl backwards whenever
      // the runtime publishes its committed snapshot.
      if (!interactiveTurn.settling && !interactiveTurn.progressValue) {
        animatedProgress.set(Math.min(1, Math.max(0, interactiveTurn.progress)));
      }
      return;
    }
    if (current && samePageIdentity(current.snapshot, interactiveCommit) && current.key !== displayedContent?.key) {
      setDisplayedContent(current);
      setInteractiveCommit(undefined);
      setTransition(undefined);
      animatedProgress.set(1);
      return;
    }
    if (interactiveCommit && current?.key === displayedContent?.key) {
      setInteractiveCommit(undefined);
    }
    // Runtime navigation can publish several later snapshots while this
    // retained adjacent pair is still moving. Keep its timing driver intact.
    if (automaticTransition && automaticTurn) {
      if (displayedContent?.key !== automaticTurn.to.key) {
        setDisplayedContent(automaticTurn.to);
      }
      if (transition) setTransition(undefined);
      return;
    }
    if (!current) {
      // The surface has no drawable content during loading/reflow; clear the
      // retained page before the next ready frame is considered.
      setDisplayedContent(undefined);
      animatedProgress.set(1);
      return;
    }
    if (displayedContent?.key === current.key) {
      if (displayedContent !== current) setDisplayedContent(current);
      return;
    }

    if (suppressAutomaticTransition) {
      setDisplayedContent(current);
      setTransition(undefined);
      animatedProgress.set(1);
      return;
    }

    const previous = displayedContent;
    setDisplayedContent(current);
    const sameSurface =
      previous &&
      previous.frame.width === current.frame.width &&
      previous.frame.height === current.frame.height &&
      previous.snapshot.revisionId === current.snapshot.revisionId;
    if (sameSurface && previous.snapshot.spreadIndex !== current.snapshot.spreadIndex) {
      // Establish the start pose before publishing the transition tree. The
      // previous page remains visible during this render, so Skia never sees
      // the target page at its completed pose before the animation begins.
      animatedProgress.set(0);
      setTransition({
        from: previous,
        toKey: current.key,
        direction: current.snapshot.spreadIndex > previous.snapshot.spreadIndex ? 1 : -1,
      });
    } else {
      setTransition(undefined);
      animatedProgress.set(1);
    }
  }, [
    animatedProgress,
    automaticTransition,
    automaticTurn,
    current,
    displayedContent,
    interactiveCommit,
    interactiveTurn,
    nativeAutomaticTurnDriven,
    suppressAutomaticTransition,
    transition,
  ]);

  /* eslint-enable react-hooks/set-state-in-effect */

  useLayoutEffect(() => {
    if (!activeTransition || (interactiveTurn && (!interactiveTurn.settling || interactiveTurn.nativeGesture?.driven)))
      return;
    const handoffProgress = interactiveTurn?.settling ? (interactiveTurn.settleTo ?? 1) : undefined;
    const target = handoffProgress ?? 1;
    const automaticTurnContinues = automaticTurn !== undefined && animatedAutomaticTurnId.current === automaticTurn.id;
    const automaticStartProgress = automaticTurnContinues ? Math.min(1, Math.max(0, progress.value)) : 0;
    const duration = interactiveTurn
      ? pageTurnEffect.motion.getSettleDuration({
          fromProgress: interactiveTurn.progress,
          targetProgress: target,
          releaseVelocity: interactiveTurn.releaseVelocity ?? 0,
          throwVelocity: interactiveTurn.throwVelocity ?? 0,
          animationDuration,
          pageWidth: width,
          direction,
          spreadMode,
          fingerX: interactiveTurn.fingerX ?? 1,
          pressedEdgeX: interactiveTurn.pressedEdgeX ?? 1,
          heldRollTilt: interactiveTurn.heldRollTilt ?? 0,
          startBookX: interactiveTurn.startBookX ?? 1,
        })
      : automaticTransition
        ? pageTurnEffect.motion.getAutomaticDuration({
            queuedTurnCount: automaticTurnCount,
            fromProgress: automaticStartProgress,
            animationDuration,
            incomingPageLanding,
          })
        : pageTurnEffect.motion.getDuration({
            releaseVelocity: 0,
            animationDuration,
            incomingPageLanding,
          });
    // React Skia can observe the driver swap before it removes the interactive
    // nodes. Keep both drivers at the same terminal pose during that frame.
    if (handoffProgress !== undefined) progress.set(handoffProgress);
    if (automaticTurn && !automaticTurnContinues) {
      animatedAutomaticTurnId.current = automaticTurn.id;
    } else if (!automaticTurn) {
      animatedAutomaticTurnId.current = undefined;
    }
    if (!interactiveTurn?.settling && !automaticTurnContinues && animatedProgress.value !== 0) {
      animatedProgress.set(0);
    }
    const easing = pageTurnEffect.motion.getEasing({
      fromProgress: interactiveTurn?.progress ?? automaticStartProgress,
      targetProgress: target,
      releaseVelocityPxPerMs: ((interactiveTurn?.releaseVelocity ?? 0) * width) / 1000,
      incomingPageLanding,
      interactive: interactiveTurn !== undefined,
    });
    animatedProgress.set(
      withTiming(
        target,
        {
          duration,
          easing,
        },
        (finished) => {
          if (!finished) return;
          if (interactiveTurn?.settling && interactiveTurn.onSettleComplete) {
            scheduleOnRN(interactiveTurn.onSettleComplete);
          } else if (automaticTransition && automaticTurn && onAutomaticTurnComplete) {
            scheduleOnRN(onAutomaticTurnComplete, automaticTurn.id);
          } else if (!interactiveTurn) {
            scheduleOnRN(clearTransition, activeTransition.toKey);
          }
        },
      ),
    );
    return () => cancelAnimation(animatedProgress);
  }, [
    activeTransition,
    animatedProgress,
    animationDuration,
    automaticTransition,
    automaticTurn,
    automaticTurnCount,
    clearTransition,
    direction,
    incomingPageLanding,
    interactiveTurn,
    onAutomaticTurnComplete,
    pageTurnEffect,
    progress,
    spreadMode,
    width,
  ]);

  return {
    transition: activeTransition,
    visibleContent,
    visualKind: pageTurnEffect.visual.kind,
    coverMatrix: visualValues.primaryMatrix,
    incomingSlideMatrix: visualValues.incomingMatrix,
    outgoingSlideMatrix: visualValues.outgoingMatrix,
    progress: animatedProgress,
    grabX,
    grabY,
  };
}

function samePageIdentity(left: ReaderPageIdentity | undefined, right: ReaderPageIdentity | undefined): boolean {
  return Boolean(
    left &&
    right &&
    left.revisionId === right.revisionId &&
    left.spreadIndex === right.spreadIndex &&
    left.renderId === right.renderId,
  );
}
