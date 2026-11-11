import { useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import { consumeNativePagerInputOnUI } from '../native/pager-compositor';
import type { PageTurnGestureValues } from './use-page-turn-pan-gesture';

/** The share of the page width at either side where a tap turns the page. */
export const PAGE_TURN_TAP_ZONE = 0.3;
/** A link or footnote answers a tap this far outside its bounds, as its press target does. */
const BLOCKER_SLOP = 6;
/**
 * A finger that travels farther than this, or stays down longer, is not a tap.
 * It stays below the pan's 8px activation: one touch never both turns a page
 * here and starts a drag the runtime would then have to reconcile.
 */
const TAP_SLOP = 6;
const TAP_MAX_DURATION_MS = 500;

/** Which way a tap at `x` turns the page: 1 forward, -1 back, 0 for the middle of the page. */
export function pageTurnTapDirection(x: number, width: number): 1 | -1 | 0 {
  'worklet';
  if (x < width * PAGE_TURN_TAP_ZONE) return -1;
  if (x > width * (1 - PAGE_TURN_TAP_ZONE)) return 1;
  return 0;
}

/** The wall clock RN compares a press against when it claims a native tap. */
function nativeTapClockMs(): number {
  'worklet';
  return Date.now();
}

/** Whether (x, y) falls on one of the flattened x, y, width, height regions. */
export function pageTurnTapBlocked(blockers: readonly number[], x: number, y: number): boolean {
  'worklet';
  for (let index = 0; index + 3 < blockers.length; index += 4) {
    const left = blockers[index]! - BLOCKER_SLOP;
    const top = blockers[index + 1]! - BLOCKER_SLOP;
    const right = blockers[index]! + blockers[index + 2]! + BLOCKER_SLOP;
    const bottom = blockers[index + 1]! + blockers[index + 3]! + BLOCKER_SLOP;
    if (x >= left && x <= right && y >= top && y <= bottom) return true;
  }
  return false;
}

interface PageTurnTapGestureOptions {
  /** Told on the RN thread that the composer took a tap, so its events are read. */
  readonly onNativeTap: () => void;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly spreadMode: ReaderSpreadMode;
  readonly values: PageTurnGestureValues;
  readonly viewport?: ReaderViewport;
}

/**
 * Turns the page for a tap in a turn zone in the composer, on the UI thread,
 * when it holds the next page: the sheet starts in the frame the finger lifts,
 * whatever RN is doing.
 *
 * The gesture activates only for a tap the composer took. An activated
 * gesture cancels RN's touch responders, so every other tap — the middle of
 * the page, a link, footnote, image or highlight, a page the composer does not
 * hold — fails here and reaches RN's press handling untouched. RN still asks
 * `claimNativeTap`, for a platform that delivers the press regardless.
 */
export function usePageTurnTapGesture({
  onNativeTap,
  pageTurnEffect,
  spreadMode,
  values,
  viewport,
}: PageTurnTapGestureOptions): GestureType {
  const width = viewport?.width ?? 0;
  const nativeTapsEnabled = pageTurnEffect.native !== undefined && spreadMode === 'single';
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const downAtMs = useSharedValue(0);

  /* eslint-disable react-hooks/immutability */
  return useMemo(() => {
    const {
      nativeInputReady,
      nativePagerId,
      nativeTapAtMs,
      nativeTapBlockers,
      nativeTapEnabled,
      nativeTapLead,
      nativeTapSerial,
    } = values;
    return Gesture.Manual()
      .enabled(nativeTapsEnabled && width > 0)
      .onTouchesDown((event, manager) => {
        'worklet';
        const touch = event.allTouches[0];
        if (event.numberOfTouches !== 1 || !touch) {
          manager.fail();
          return;
        }
        downX.value = touch.x;
        downY.value = touch.y;
        downAtMs.value = nativeTapClockMs();
      })
      .onTouchesMove((event, manager) => {
        'worklet';
        const touch = event.allTouches[0];
        if (!touch || Math.hypot(touch.x - downX.value, touch.y - downY.value) > TAP_SLOP) manager.fail();
      })
      .onTouchesUp((event, manager) => {
        'worklet';
        const touch = event.changedTouches[0];
        const x = downX.value;
        const y = downY.value;
        const direction = pageTurnTapDirection(x, width);
        if (
          !touch ||
          Math.hypot(touch.x - x, touch.y - y) > TAP_SLOP ||
          nativeTapClockMs() - downAtMs.value > TAP_MAX_DURATION_MS ||
          direction === 0 ||
          !nativeTapEnabled.value ||
          !nativeInputReady.value ||
          nativePagerId.value < 0 ||
          (!nativeTapLead.value && pageTurnTapBlocked(nativeTapBlockers.value, x, y)) ||
          consumeNativePagerInputOnUI(nativePagerId.value, direction) !== true
        ) {
          manager.fail();
          return;
        }
        nativeTapAtMs.value = nativeTapClockMs();
        nativeTapSerial.value += 1;
        scheduleOnRN(onNativeTap);
        manager.activate();
        manager.end();
      })
      .onTouchesCancelled((_event, manager) => {
        'worklet';
        manager.fail();
      });
  }, [downAtMs, downX, downY, nativeTapsEnabled, onNativeTap, values, width]);
  /* eslint-enable react-hooks/immutability */
}
