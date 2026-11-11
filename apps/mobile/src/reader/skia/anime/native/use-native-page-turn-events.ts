import type { CanvasRef } from '@shopify/react-native-skia';
import { useEffect, useRef, useState, type RefObject } from 'react';

import type { ReaderAutomaticTurn, ReaderInteractiveTurn } from '../core/page-turn-types';
import { readerAutomaticPageTurnId, readerInteractivePageTurnIdentity } from './page-turn';
import {
  readerPerformanceActivity,
  readerPerformanceMark,
  readerPerformanceStart,
} from '../../../runtime/core/performance';
import { takeNativePagerEvents, type NativePagerEventRecord } from './pager-compositor';

interface NativePageTurnEventsOptions {
  readonly active: boolean;
  readonly automaticActive: boolean;
  readonly canvasRef: RefObject<CanvasRef | null>;
  readonly interactiveTurn?: ReaderInteractiveTurn;
  /** The composer turns pages on taps by itself: nothing RN scheduled is in flight, yet its events matter. */
  readonly nativeTapEventsActive?: boolean;
  readonly onComplete?: (turnId: number) => void;
  /** Receives every event that does not belong to a submitted automatic turn. */
  readonly onNativeEvent?: (event: NativePagerEventRecord) => void;
  readonly submittedTurnIds: RefObject<Set<number>>;
  readonly turns: readonly ReaderAutomaticTurn[];
}

export function useNativePageTurnEvents({
  active,
  automaticActive,
  canvasRef,
  interactiveTurn,
  nativeTapEventsActive = false,
  onComplete,
  onNativeEvent,
  submittedTurnIds,
  turns,
}: NativePageTurnEventsOptions): number | undefined {
  const presentedTurnIds = useRef(new Set<number>());
  const [presentedTurnId, setPresentedTurnId] = useState<number>();
  const onCompleteRef = useRef(onComplete);
  const onNativeEventRef = useRef(onNativeEvent);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onNativeEventRef.current = onNativeEvent;
  }, [onNativeEvent]);

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

  // Poll while anything native is in flight. The latest turns are read
  // through refs, so the interval is not rebuilt on every turn update.
  const turnsRef = useRef(turns);
  const interactiveTurnRef = useRef(interactiveTurn);
  useEffect(() => {
    turnsRef.current = turns;
    interactiveTurnRef.current = interactiveTurn;
  }, [interactiveTurn, turns]);
  const polling =
    active && ((automaticActive && turns.length > 0) || interactiveTurn !== undefined || nativeTapEventsActive);

  useEffect(() => {
    if (!polling) return;
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
        const interactive = interactiveTurnRef.current;
        const workId =
          turnId !== undefined
            ? turnsRef.current.find((turn) => turn.id === turnId)?.performanceId
            : gesture?.gestureToken === interactive?.nativeGesture?.token
              ? interactive?.performanceId
              : undefined;
        readerPerformanceMark('reader.native.event', {
          workId,
          nativeId: event.id,
          event: event.event,
          nativeAtMs: event.eventAtMs,
          deliveryDelayMs: Math.max(0, Date.now() - event.eventAtMs),
        });
        if (turnId === undefined || !submittedTurnIds.current.has(turnId)) {
          onNativeEventRef.current?.(event);
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
  }, [canvasRef, polling, submittedTurnIds]);

  return presentedTurnId;
}
