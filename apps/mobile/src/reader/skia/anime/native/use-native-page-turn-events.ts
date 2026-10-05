import type { CanvasRef } from '@shopify/react-native-skia';
import { useEffect, useRef, useState, type RefObject } from 'react';

import type { ReaderAutomaticTurn, ReaderInteractiveTurn } from '../core/page-turn-types';
import { readerAutomaticPageTurnId, readerInteractivePageTurnIdentity } from './page-turn';
import {
  readerPerformanceActivity,
  readerPerformanceMark,
  readerPerformanceStart,
} from '../../../runtime/core/performance';
import type { ReaderPageTurnSurfaceBinding } from './page-turn-binding';
import { takeNativePagerEvents } from './pager-compositor';

interface NativePageTurnEventsOptions {
  readonly active: boolean;
  readonly automaticActive: boolean;
  readonly canvasRef: RefObject<CanvasRef | null>;
  readonly interactiveTurn?: ReaderInteractiveTurn;
  readonly onComplete?: (turnId: number) => void;
  readonly submittedTurnIds: RefObject<Set<number>>;
  readonly surfaceBinding?: ReaderPageTurnSurfaceBinding;
  readonly turns: readonly ReaderAutomaticTurn[];
}

export function useNativePageTurnEvents({
  active,
  automaticActive,
  canvasRef,
  interactiveTurn,
  onComplete,
  submittedTurnIds,
  surfaceBinding,
  turns,
}: NativePageTurnEventsOptions): number | undefined {
  const presentedTurnIds = useRef(new Set<number>());
  const [presentedTurnId, setPresentedTurnId] = useState<number>();
  const onCompleteRef = useRef(onComplete);
  const surfaceBindingRef = useRef(surfaceBinding);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    surfaceBindingRef.current = surfaceBinding;
  }, [surfaceBinding]);

  useEffect(() => {
    const liveTurnIds = new Set(turns.map((turn) => turn.id));
    const presented = presentedTurnIds.current;
    for (const turnId of presented) {
      if (!liveTurnIds.has(turnId)) {
        presented.delete(turnId);
      }
    }
    setPresentedTurnId(turns.findLast((turn) => presented.has(turn.id))?.id);
  }, [turns]);

  useEffect(() => {
    if (active) return;
    if (presentedTurnIds.current.size === 0) return;
    presentedTurnIds.current.clear();
    setPresentedTurnId(undefined);
  }, [active]);

  useEffect(() => {
    if (!active || (!(automaticActive && turns.length > 0) && !interactiveTurn)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drainEvents = () => {
      const startedAt = readerPerformanceStart();
      const events = takeNativePagerEvents(canvas);
      if (startedAt !== undefined)
        readerPerformanceActivity('native.poll', performance.now() - startedAt, { events: events.length });
      for (const event of events) {
        const turnId = readerAutomaticPageTurnId(event.id);
        const gesture = readerInteractivePageTurnIdentity(event.id);
        const workId =
          turnId !== undefined
            ? turns.find((turn) => turn.id === turnId)?.performanceId
            : gesture?.gestureToken === interactiveTurn?.nativeGesture?.token
              ? interactiveTurn?.performanceId
              : undefined;
        readerPerformanceMark('reader.native.event', {
          workId,
          nativeId: event.id,
          event: event.event,
          nativeAtMs: event.eventAtMs,
          deliveryDelayMs: Math.max(0, Date.now() - event.eventAtMs),
        });
        if (turnId === undefined || !submittedTurnIds.current.has(turnId)) {
          surfaceBindingRef.current?.onNativeEvent(event);
          continue;
        }
        if (event.event === 'started') {
          const presented = presentedTurnIds.current;
          presented.add(turnId);
          setPresentedTurnId(turnId);
          continue;
        }
        if (event.event !== 'completed' && event.event !== 'cancelled') continue;
        submittedTurnIds.current.delete(turnId);
        onCompleteRef.current?.(turnId);
      }
    };
    drainEvents();
    const timer = setInterval(drainEvents, 16);
    return () => {
      clearInterval(timer);
      drainEvents();
    };
  }, [active, automaticActive, canvasRef, interactiveTurn, submittedTurnIds, turns]);

  return presentedTurnId;
}
