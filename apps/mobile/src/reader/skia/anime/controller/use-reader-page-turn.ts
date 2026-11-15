import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';

import type { ReaderSnapshot, ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import type { ReaderPageAnimationStyle } from '../core/page-turn-types';
import { getReaderPageTurnEffect } from '../effects/page-turn-effects';
import { usePageTurnGestureValues, usePageTurnPanGesture } from '../gesture/use-page-turn-pan-gesture';
import { usePageTurnTapGesture } from '../gesture/use-page-turn-tap-gesture';
import type { ReaderPageTurnSurfaceBinding } from '../native/page-turn-binding';
import { usePageTurnState, type ReaderPageTurnState } from './page-turn-store';
import { ReaderPageTurnCoordinator } from './reader-page-turn-coordinator';

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
  /** The drag and, where the composer can take it, the tap that turn pages. */
  readonly gesture: ComposedGesture;
  readonly automaticNavigationActive: boolean;
  readonly isSettling: boolean;
  /** Hand to `ReaderSurface`; the surface hands its pages to the native composer. */
  readonly surfaceBinding: ReaderPageTurnSurfaceBinding;
  next(): Promise<ReaderSnapshot>;
  previous(): Promise<ReaderSnapshot>;
  /**
   * Whether the composer already turned the page for the press RN is handling,
   * on the UI thread; the press is then spent and must not turn it again.
   */
  claimNativeTap(): boolean;
  /**
   * Whether a tap in a turn zone may turn the page in the composer, and the
   * regions (x, y, width, height in view coordinates, flattened) where a tap
   * means something else and is left to RN.
   */
  setTapGuard(enabled: boolean, blockers: readonly number[]): void;
}

interface ReaderPageTurnBusyState {
  readonly isSettling: boolean;
  readonly automaticNavigationActive: boolean;
}

const selectBusyState = (state: ReaderPageTurnState): ReaderPageTurnBusyState => ({
  isSettling: state.isSettling,
  automaticNavigationActive: state.automaticNavigationActive,
});

const sameBusyState = (left: ReaderPageTurnBusyState, right: ReaderPageTurnBusyState): boolean =>
  left.isSettling === right.isSettling && left.automaticNavigationActive === right.automaticNavigationActive;

/**
 * Connects the reader screen to its page-turn controller. The screen re-renders
 * only when a turn starts or ends blocking input; the native composer draws
 * every page and turn behind `ReaderSurface`.
 */
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
  const values = usePageTurnGestureValues();
  const config = useMemo(
    () => ({ viewport, pageTurnEffect, spreadMode, animationDuration, surfaceTop }),
    [animationDuration, pageTurnEffect, spreadMode, surfaceTop, viewport],
  );
  // One controller per runtime. It is created in state rather than a memo so
  // React never discards it while it still owns native and runtime resources.
  const [controller, setController] = useState(() => new ReaderPageTurnCoordinator(runtime, values, config));
  if (controller.runtime !== runtime) {
    setController(new ReaderPageTurnCoordinator(runtime, values, config));
  }

  useEffect(() => controller.attach(), [controller]);
  useLayoutEffect(() => controller.configure(config), [config, controller]);
  useLayoutEffect(() => controller.setSubscriberSnapshot(snapshot), [controller, snapshot]);

  const panGesture = usePageTurnPanGesture({
    beginDrag: controller.beginDrag,
    endDrag: controller.endDrag,
    markNativeGestureAccepted: controller.markNativeGestureAccepted,
    pageTurnEffect,
    spreadMode,
    updateDrag: controller.updateDrag,
    values,
    viewport,
  });
  const tapGesture = usePageTurnTapGesture({
    onNativeTap: controller.noteNativeTap,
    pageTurnEffect,
    values,
    viewport,
  });
  const gesture = useMemo(() => Gesture.Simultaneous(panGesture, tapGesture), [panGesture, tapGesture]);
  const busy = usePageTurnState(controller.store, selectBusyState, sameBusyState);
  const surfaceBinding = useMemo<ReaderPageTurnSurfaceBinding>(
    () => ({
      store: controller.store,
      values,
      onNativeEvent: controller.handleNativeEvent,
      onStocked: controller.markStocked,
      onStockLost: controller.markStockLost,
      takeTurnIntent: controller.takeTurnIntent,
    }),
    [controller, values],
  );

  return {
    gesture,
    automaticNavigationActive: busy.automaticNavigationActive,
    isSettling: busy.isSettling,
    surfaceBinding,
    next: controller.next,
    previous: controller.previous,
    claimNativeTap: controller.claimNativeTap,
    setTapGuard: controller.setTapGuard,
  };
}
