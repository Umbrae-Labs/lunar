import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  useAnimatedReaction,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { runOnUI, scheduleOnRN } from 'react-native-worklets';

import type { ReaderViewport } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import type { ReaderSurfaceTransform } from '../../rendering/surface-transform';
import { setNativePagerStripOffsetOnUI } from '../native/pager-compositor';
import {
  ReaderScrollCoordinator,
  type ReaderScrollHit,
  type ReaderScrollState,
  type ReaderScrollValues,
} from './reader-scroll-coordinator';

/** What `ReaderScrollSurface` reads to show the strip. */
export interface ReaderScrollSurfaceBinding {
  readonly coordinator: ReaderScrollCoordinator;
  readonly values: ReaderScrollValues;
  /** The surface's composer view, once it registered; -1 before. */
  readonly nativePagerId: SharedValue<number>;
}

export interface ReaderScrollController {
  /** The vertical drag and fling that scroll the strip. */
  readonly gesture: PanGesture;
  readonly binding: ReaderScrollSurfaceBinding;
  /** Scrolls one screen of reading forward or back, keeping a line in view. */
  scrollBy(direction: 1 | -1): void;
  /** The window under a view point and the point in its display-list space. */
  hitAt(x: number, y: number): ReaderScrollHit | undefined;
  /**
   * Whether the press RN is handling only stopped a fling; such a press is
   * spent and must not also open content or toggle the controls.
   */
  claimStoppingTap(): boolean;
  /** Maps the view to the runtime's window while the strip rests; undefined while it moves. */
  readonly transform?: ReaderSurfaceTransform;
  /**
   * Makes the window under a view point the runtime's own, for a selection
   * there: true at once when it already is, otherwise whether it got there.
   */
  focusAt(x: number, y: number): true | Promise<boolean>;
  /** Hands the runtime back to the reading line once the selection is gone. */
  release(): void;
  /** Holds the strip still, as while a selection is shown over it. */
  lock(locked: boolean): void;
}

export interface UseReaderScrollOptions {
  readonly runtime: LunarReaderRuntime;
  readonly viewport?: ReaderViewport;
  /** Off in paged mode: the coordinator neither follows the runtime nor peeks. */
  readonly enabled: boolean;
}

/** A line of overlap kept when a whole screen scrolls by. */
const SCROLL_BY_OVERLAP = 32;
const SCROLL_BY_DURATION_MS = 280;

export function useReaderScroll({ runtime, viewport, enabled }: UseReaderScrollOptions): ReaderScrollController {
  const offset = useSharedValue(0);
  const minOffset = useSharedValue(0);
  const maxOffset = useSharedValue(0);
  const visibleTop = useSharedValue(0);
  const visibleLength = useSharedValue(0);
  const readingLine = useSharedValue(0);
  const pendingStep = useSharedValue(0);
  const holding = useSharedValue(false);
  const locked = useSharedValue(false);
  const nativePagerId = useSharedValue(-1);
  const flinging = useSharedValue(false);
  const swallowTap = useSharedValue(false);
  const values = useMemo<ReaderScrollValues>(
    () => ({ offset, minOffset, maxOffset, visibleTop, visibleLength, readingLine, pendingStep, holding }),
    [holding, maxOffset, minOffset, offset, pendingStep, readingLine, visibleLength, visibleTop],
  );
  const config = useMemo(
    () => ({ viewportWidth: viewport?.width ?? 0, viewportHeight: viewport?.height ?? 0 }),
    [viewport?.height, viewport?.width],
  );
  // One coordinator per runtime, kept in state so React never discards it
  // while it still follows that runtime.
  const [coordinator, setCoordinator] = useState(() => new ReaderScrollCoordinator(runtime, values, config));
  if (coordinator.runtime !== runtime) {
    setCoordinator(new ReaderScrollCoordinator(runtime, values, config));
  }
  useLayoutEffect(() => coordinator.configure(config), [config, coordinator]);
  useEffect(() => (enabled ? coordinator.attach() : undefined), [coordinator, enabled]);
  // Worklets copy what they capture and cannot copy a class instance: they
  // reach the coordinator only through these functions, which run on RN.
  const { step, settle, unsettle } = coordinator;
  const transform = useSyncExternalStore(coordinator.subscribeTransform, coordinator.getTransform);

  // The composer draws the strip at the offset of every frame.
  useAnimatedReaction(
    () => offset.value,
    (current, previous) => {
      if (current !== previous) setNativePagerStripOffsetOnUI(nativePagerId.value, current);
    },
    [nativePagerId],
  );
  // The runtime follows the reading line one window at a time.
  /* eslint-disable react-hooks/immutability */
  useAnimatedReaction(
    () =>
      [
        offset.value + readingLine.value,
        visibleTop.value,
        visibleLength.value,
        pendingStep.value,
        holding.value,
      ] as const,
    ([line, top, length, pending, held]) => {
      if (!enabled || held || pending !== 0 || length <= 0) return;
      if (line >= top + length) {
        pendingStep.value = 1;
        scheduleOnRN(step, 1);
      } else if (line < top) {
        pendingStep.value = -1;
        scheduleOnRN(step, -1);
      }
    },
    [enabled, step],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onBegin(() => {
          'worklet';
          // A finger on a fling stops it; that touch is not also a tap.
          if (flinging.value) {
            cancelAnimation(offset);
            flinging.value = false;
            swallowTap.value = true;
            scheduleOnRN(settle);
          }
        })
        .onStart(() => {
          'worklet';
          if (!locked.value) scheduleOnRN(unsettle);
        })
        .onChange((event) => {
          'worklet';
          if (locked.value) return;
          const next = offset.value - event.changeY;
          offset.value = Math.min(maxOffset.value, Math.max(minOffset.value, next));
        })
        .onEnd((event) => {
          'worklet';
          if (locked.value) return;
          flinging.value = true;
          offset.value = withDecay(
            { velocity: -event.velocityY, clamp: [minOffset.value, maxOffset.value] },
            (finished) => {
              flinging.value = false;
              if (finished) scheduleOnRN(settle);
            },
          );
        }),
    [enabled, flinging, locked, maxOffset, minOffset, offset, settle, swallowTap, unsettle],
  );
  /* eslint-enable react-hooks/immutability */

  const viewportHeight = viewport?.height ?? 0;
  const binding = useMemo<ReaderScrollSurfaceBinding>(
    () => ({ coordinator, values, nativePagerId }),
    [coordinator, nativePagerId, values],
  );
  return useMemo<ReaderScrollController>(
    () => ({
      gesture,
      binding,
      scrollBy: (direction) => {
        unsettle();
        runOnUI((distance: number) => {
          'worklet';
          const target = Math.min(maxOffset.value, Math.max(minOffset.value, offset.value + distance));
          offset.value = withTiming(target, { duration: SCROLL_BY_DURATION_MS }, (finished) => {
            if (finished) scheduleOnRN(settle);
          });
        })(direction * Math.max(1, viewportHeight - SCROLL_BY_OVERLAP));
      },
      hitAt: (x, y) => coordinator.hitAt(x, y),
      claimStoppingTap: () => {
        if (!swallowTap.get()) return false;
        swallowTap.set(false);
        return true;
      },
      transform: enabled ? transform : undefined,
      focusAt: (x, y) => coordinator.focusAt(x, y),
      release: coordinator.release,
      lock: (value) => locked.set(value),
    }),
    [
      binding,
      coordinator,
      enabled,
      gesture,
      locked,
      maxOffset,
      minOffset,
      offset,
      settle,
      swallowTap,
      transform,
      unsettle,
      viewportHeight,
    ],
  );
}

/** The strip's windows for a surface to draw. */
export function useReaderScrollState(coordinator: ReaderScrollCoordinator): ReaderScrollState {
  return useSyncExternalStore(coordinator.subscribe, coordinator.getState);
}
