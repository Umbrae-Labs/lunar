import { useCallback, useEffect, useRef } from 'react';
import type { PanGesture } from 'react-native-gesture-handler';

import type { ReaderSnapshot, ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import type { ReaderAutomaticTurn, ReaderInteractiveTurn, ReaderPageAnimationStyle } from '../core/page-turn-types';
import { getReaderPageTurnEffect } from '../effects/page-turn-effects';
import type { ReaderPageTurnSurfaceBinding } from '../native/page-turn-binding';
import { useAutomaticPageTurnNavigation } from './use-automatic-page-turn-navigation';
import { useInteractivePageTurn } from './use-interactive-page-turn';

export type { ReaderPageTurnSurfaceBinding } from '../native/page-turn-binding';

export interface UseReaderPageTurnOptions {
  readonly runtime: LunarReaderRuntime;
  readonly snapshot: ReaderSnapshot;
  readonly viewport?: ReaderViewport;
  readonly animationStyle?: ReaderPageAnimationStyle;
  readonly animationDuration?: number;
  readonly spreadMode?: ReaderSpreadMode;
  /** Vertical viewport offset of the reader surface, used with absolute gesture coordinates. */
  readonly surfaceTop?: number;
}

export interface ReaderPageTurnController {
  readonly gesture: PanGesture;
  readonly interactiveTurn?: ReaderInteractiveTurn;
  readonly automaticTurns: readonly ReaderAutomaticTurn[];
  readonly automaticNavigationActive: boolean;
  readonly isSettling: boolean;
  readonly surfaceBinding: ReaderPageTurnSurfaceBinding;
  completeAutomaticTurn(turnId: number): void;
  next(): Promise<ReaderSnapshot>;
  previous(): Promise<ReaderSnapshot>;
}

export function useReaderPageTurn({
  runtime,
  snapshot,
  viewport,
  animationStyle = 'slide',
  animationDuration = 360,
  spreadMode = 'double',
  surfaceTop = 0,
}: UseReaderPageTurnOptions): ReaderPageTurnController {
  const pageTurnEffect = getReaderPageTurnEffect(animationStyle);
  const prepareInteractiveTurnRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const prepareForAutomaticNavigation = useCallback(() => prepareInteractiveTurnRef.current(), []);
  const automatic = useAutomaticPageTurnNavigation({
    beforeNavigate: prepareForAutomaticNavigation,
    pageTurnEffect,
    runtime,
  });
  const interactive = useInteractivePageTurn({
    runtime,
    snapshot,
    viewport,
    animationDuration,
    pageTurnEffect,
    spreadMode,
    automaticNavigationActive: automatic.active,
    surfaceTop,
  });

  useEffect(() => {
    prepareInteractiveTurnRef.current = interactive.prepareForAutomaticNavigation;
  }, [interactive.prepareForAutomaticNavigation]);

  const pageTurnActive = automatic.active || interactive.interactiveTurn !== undefined;
  useEffect(() => {
    if (pageTurnActive) return runtime.suspendBackgroundPagination();
  }, [pageTurnActive, runtime]);

  return {
    gesture: interactive.gesture,
    interactiveTurn: interactive.interactiveTurn,
    automaticTurns: automatic.turns,
    automaticNavigationActive: automatic.active,
    isSettling: interactive.isSettling,
    surfaceBinding: interactive.surfaceBinding,
    completeAutomaticTurn: automatic.complete,
    next: automatic.next,
    previous: automatic.previous,
  };
}
