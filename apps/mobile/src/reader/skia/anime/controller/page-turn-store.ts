import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { ReaderPageContent } from '../core/page-turn-types';

/**
 * A pair the native composer should hold for the next input. Pairs stocked
 * while the reader is idle carry no prepared turn (`preparedTurnId` 0): the
 * drag that consumes one prepares its runtime turn while the composer moves.
 */
export interface ReaderPageTurnStock {
  readonly token: number;
  readonly preparedTurnId: number;
  readonly direction: 1 | -1;
  readonly source: ReaderPageContent;
  readonly target: ReaderPageContent;
  /** The page whose surroundings this pair was stocked for. */
  readonly around: string;
  /** How many turns from `around` the pair's target is: 1 leaves that page itself. */
  readonly distance: number;
  readonly performanceId?: string;
}

export interface ReaderPageTurnState {
  /** RN navigation is queued or running, or the runtime follows pages the composer turned. */
  readonly automaticNavigationActive: boolean;
  /** A released drag waits for its runtime turn. */
  readonly isSettling: boolean;
  /** A page turn of any kind is in progress; transient UI such as a selection stays hidden. */
  readonly turning: boolean;
  /** Pairs chained outward from one page, at most one per direction and distance. */
  readonly stocks: readonly ReaderPageTurnStock[];
  /** The composer moves on its own (taps, drags): its events must be read. */
  readonly composerEventsActive: boolean;
  /** A finger drives a composer sheet: its pair keeps the textures it started with. */
  readonly nativeGestureDriven: boolean;
  /** Bumped when the composer must show the runtime's page, whatever it turned to by itself. */
  readonly presentEpoch: number;
}

export const INITIAL_PAGE_TURN_STATE: ReaderPageTurnState = {
  automaticNavigationActive: false,
  isSettling: false,
  turning: false,
  stocks: [],
  composerEventsActive: false,
  nativeGestureDriven: false,
  presentEpoch: 0,
};

/**
 * Page-turn state lives outside React so that only the components that need a
 * slice re-render while pages turn. The reader screen subscribes to the coarse
 * flags it gates interaction on; the surface to what it hands the composer.
 */
export class ReaderPageTurnStore {
  private state: ReaderPageTurnState = INITIAL_PAGE_TURN_STATE;
  private readonly listeners = new Set<() => void>();

  readonly getState = (): ReaderPageTurnState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setState(next: ReaderPageTurnState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/** Subscribes to one slice of the page-turn state; equal slices skip the render. */
export function usePageTurnState<T>(
  store: ReaderPageTurnStore,
  select: (state: ReaderPageTurnState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const cache = useRef<{ readonly state: ReaderPageTurnState; readonly value: T } | undefined>(undefined);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const cached = cache.current;
    if (cached?.state === state) return cached.value;
    const value = select(state);
    if (cached && isEqual(cached.value, value)) {
      cache.current = { state, value: cached.value };
      return cached.value;
    }
    cache.current = { state, value };
    return value;
  }, [isEqual, select, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
