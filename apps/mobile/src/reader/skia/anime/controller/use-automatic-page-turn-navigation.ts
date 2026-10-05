import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReaderSnapshot } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import {
  readerPerformanceAsync,
  readerPerformanceEnd,
  readerPerformanceId,
  readerPerformanceMark,
  readerPerformanceStart,
} from '../../../runtime/core/performance';
import {
  AUTOMATIC_PAGE_TURN_MAX_LANES,
  AUTOMATIC_PAGE_TURN_START_INTERVAL_MS,
  appendAutomaticPageTurn,
} from '../core/page-turn-concurrency';
import { readerPageContentForSnapshot, sameSnapshotIdentity } from '../core/page-content';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import type { ReaderAutomaticTurn } from '../core/page-turn-types';

interface AutomaticPageTurnNavigationOptions {
  readonly beforeNavigate: () => Promise<void>;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly runtime: LunarReaderRuntime;
}

interface AutomaticPageTurnNavigation {
  readonly active: boolean;
  readonly turns: readonly ReaderAutomaticTurn[];
  readonly complete: (turnId: number) => void;
  readonly next: () => Promise<ReaderSnapshot>;
  readonly previous: () => Promise<ReaderSnapshot>;
}

export function useAutomaticPageTurnNavigation({
  beforeNavigate,
  pageTurnEffect,
  runtime,
}: AutomaticPageTurnNavigationOptions): AutomaticPageTurnNavigation {
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const nextStartAt = useRef(0);
  const direction = useRef<1 | -1 | undefined>(undefined);
  const pendingCount = useRef(0);
  const availableLaneWaiters = useRef<(() => void)[]>([]);
  const turnsRef = useRef<readonly ReaderAutomaticTurn[]>([]);
  const turnSequence = useRef(0);
  const controllerRuntime = useRef(runtime);
  const [turns, setTurns] = useState<readonly ReaderAutomaticTurn[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);

  const complete = useCallback((turnId: number) => {
    const nextTurns = turnsRef.current.filter((turn) => turn.id !== turnId);
    if (nextTurns.length === turnsRef.current.length) return;
    const completed = turnsRef.current.find((turn) => turn.id === turnId);
    readerPerformanceMark('reader.turn.complete', { workId: completed?.performanceId, turnId, mode: 'automatic' });
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    availableLaneWaiters.current.shift()?.();
    if (nextTurns.length === 0 && pendingCount.current === 0) {
      direction.current = undefined;
    }
  }, []);

  const enqueue = useCallback(
    (turnDirection: 1 | -1) => {
      const performanceId = readerPerformanceId('automatic');
      const queuedAt = readerPerformanceStart();
      const serializesTurns = pageTurnEffect.orchestration.serializesAutomaticTurns;
      if (serializesTurns) {
        if (direction.current !== undefined && direction.current !== turnDirection) {
          return Promise.resolve(runtime.getSnapshot());
        }
        direction.current = turnDirection;
      }
      pendingCount.current += 1;
      setPendingRequests(pendingCount.current);
      const requestGeneration = generation.current;
      return new Promise<ReaderSnapshot>((resolve, reject) => {
        const run = async () => {
          try {
            if (generation.current !== requestGeneration) {
              resolve(runtime.getSnapshot());
              return;
            }
            while (turnsRef.current.length >= AUTOMATIC_PAGE_TURN_MAX_LANES) {
              await new Promise<void>((laneAvailable) => {
                availableLaneWaiters.current.push(laneAvailable);
              });
              if (generation.current !== requestGeneration) {
                resolve(runtime.getSnapshot());
                return;
              }
            }
            if (serializesTurns) {
              const startDelay = Math.max(0, nextStartAt.current - Date.now());
              if (startDelay > 0) await waitForPageTurn(startDelay);
              if (generation.current !== requestGeneration) {
                resolve(runtime.getSnapshot());
                return;
              }
            }
            readerPerformanceEnd('reader.controller.queue', queuedAt, { workId: performanceId });
            await readerPerformanceAsync('reader.controller.prepare', beforeNavigate, { workId: performanceId });
            const before = runtime.getSnapshot();
            const from = readerPageContentForSnapshot(runtime, before);
            const result =
              turnDirection > 0 ? await runtime.next(performanceId) : await runtime.previous(performanceId);
            if (generation.current === requestGeneration && from && !sameSnapshotIdentity(before, result)) {
              const to = pageTurnEffect.orchestration.usesAutomaticTransition
                ? readerPageContentForSnapshot(runtime, result)
                : undefined;
              if (to) {
                const turn: ReaderAutomaticTurn = {
                  performanceId,
                  id: ++turnSequence.current,
                  from,
                  to,
                  direction: turnDirection,
                };
                const nextTurns = appendAutomaticPageTurn(turnsRef.current, turn);
                turnsRef.current = nextTurns;
                readerPerformanceMark('reader.turn.ready', {
                  workId: performanceId,
                  turnId: turn.id,
                  direction: turnDirection,
                  page: to.key,
                  effect: pageTurnEffect.visual.kind,
                });
                setTurns(nextTurns);
                if (serializesTurns) {
                  nextStartAt.current = Date.now() + AUTOMATIC_PAGE_TURN_START_INTERVAL_MS;
                }
              }
            }
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            pendingCount.current = Math.max(0, pendingCount.current - 1);
            setPendingRequests(pendingCount.current);
            if (pendingCount.current === 0 && turnsRef.current.length === 0) {
              direction.current = undefined;
            }
          }
        };
        queue.current = queue.current.then(run, run);
      });
    },
    [beforeNavigate, pageTurnEffect, runtime],
  );

  const next = useCallback(() => enqueue(1), [enqueue]);
  const previous = useCallback(() => enqueue(-1), [enqueue]);

  useEffect(() => {
    const laneWaiters = availableLaneWaiters.current;
    const runtimeChanged = controllerRuntime.current !== runtime;
    controllerRuntime.current = runtime;
    generation.current += 1;
    queue.current = Promise.resolve();
    nextStartAt.current = 0;
    direction.current = undefined;
    pendingCount.current = 0;
    for (const wake of laneWaiters.splice(0)) wake();
    turnsRef.current = [];
    if (runtimeChanged) {
      void Promise.resolve().then(() => {
        if (controllerRuntime.current !== runtime) return;
        setPendingRequests(0);
        setTurns([]);
      });
    }
    return () => {
      generation.current += 1;
      for (const wake of laneWaiters.splice(0)) wake();
    };
  }, [runtime]);

  return {
    active: pendingRequests > 0 || turns.length > 0,
    turns,
    complete,
    next,
    previous,
  };
}

function waitForPageTurn(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
