import { useMemo } from 'react';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ReaderSpreadMode, ReaderViewport } from '../../../contracts';
import type { ReaderPageTurnEffect } from '../core/page-turn-effect';
import {
  beginNativePagerGestureOnUI,
  cancelNativePagerGestureOnUI,
  endNativePagerGestureOnUI,
  updateNativePagerGestureOnUI,
} from '../native/pager-compositor';
import {
  directedThrowVelocity,
  gestureSampleClockMs,
  GESTURE_RELEASE_IDLE_DECAY_SECONDS,
  pageTurnLeaf,
  planarTurnProgressForTranslation,
  releaseIdleDecay,
  trackThrowAcceleration,
  trackThrowVelocity,
  type PageTurnReleaseSample,
} from './page-turn-gesture';

export interface PageTurnGestureValues {
  readonly progress: SharedValue<number>;
  readonly started: SharedValue<boolean>;
  readonly releasePending: SharedValue<boolean>;
  readonly directionLocked: SharedValue<boolean>;
  readonly direction: SharedValue<1 | -1>;
  readonly startX: SharedValue<number>;
  readonly startBookX: SharedValue<number>;
  readonly dragThrowVelocity: SharedValue<number>;
  readonly dragThrowAcceleration: SharedValue<number>;
  readonly lastSampleAtMs: SharedValue<number>;
  readonly jsSampleIndex: SharedValue<number>;
  readonly nativeActive: SharedValue<boolean>;
  readonly nativePagerId: SharedValue<number>;
  readonly nativeInputReady: SharedValue<boolean>;
  /** Tokens of the stocked pairs the composer can start from right now, per direction; 0 when none. */
  readonly nativeStockNextToken: SharedValue<number>;
  readonly nativeStockPreviousToken: SharedValue<number>;
  /** A turn is settling, queued or being handed off; new drags wait for it. */
  readonly inputBlocked: SharedValue<boolean>;
  /** A tap in a turn zone may turn the page in the composer, on the UI thread. */
  readonly nativeTapEnabled: SharedValue<boolean>;
  /** Regions where a tap means something else: x, y, width, height in view coordinates, flattened. */
  readonly nativeTapBlockers: SharedValue<readonly number[]>;
  /** The composer leads the runtime: the regions above belong to a page it has turned away from. */
  readonly nativeTapLead: SharedValue<boolean>;
  /** How many taps the composer has turned, and when the last one was. */
  readonly nativeTapSerial: SharedValue<number>;
  readonly nativeTapAtMs: SharedValue<number>;
}

interface PageTurnPanGestureOptions {
  readonly beginDrag: (x: number, y: number) => void;
  readonly endDrag: (
    velocityX?: number,
    translationX?: number,
    nativeReleased?: boolean,
    release?: PageTurnReleaseSample,
  ) => void;
  readonly markNativeGestureAccepted: (stockToken: number) => void;
  readonly pageTurnEffect: ReaderPageTurnEffect;
  readonly spreadMode: ReaderSpreadMode;
  readonly updateDrag: (
    translationX: number,
    absoluteY: number,
    throwVelocity: number,
    throwAcceleration: number,
  ) => void;
  readonly values: PageTurnGestureValues;
  readonly viewport?: ReaderViewport;
}

export function usePageTurnGestureValues(): PageTurnGestureValues {
  const progress = useSharedValue(0);
  const started = useSharedValue(false);
  const releasePending = useSharedValue(false);
  const directionLocked = useSharedValue(false);
  const direction = useSharedValue<1 | -1>(1);
  const startX = useSharedValue(0);
  const startBookX = useSharedValue(1);
  const dragThrowVelocity = useSharedValue(0);
  const dragThrowAcceleration = useSharedValue(0);
  const lastSampleAtMs = useSharedValue(0);
  const jsSampleIndex = useSharedValue(0);
  const nativeActive = useSharedValue(false);
  const nativePagerId = useSharedValue(-1);
  const nativeInputReady = useSharedValue(false);
  const nativeStockNextToken = useSharedValue(0);
  const nativeStockPreviousToken = useSharedValue(0);
  const inputBlocked = useSharedValue(false);
  const nativeTapEnabled = useSharedValue(false);
  const nativeTapBlockers = useSharedValue<readonly number[]>([]);
  const nativeTapLead = useSharedValue(false);
  const nativeTapSerial = useSharedValue(0);
  const nativeTapAtMs = useSharedValue(0);

  return useMemo(
    () => ({
      progress,
      started,
      releasePending,
      directionLocked,
      direction,
      startX,
      startBookX,
      dragThrowVelocity,
      dragThrowAcceleration,
      lastSampleAtMs,
      jsSampleIndex,
      nativeActive,
      nativePagerId,
      nativeInputReady,
      nativeStockNextToken,
      nativeStockPreviousToken,
      inputBlocked,
      nativeTapEnabled,
      nativeTapBlockers,
      nativeTapLead,
      nativeTapSerial,
      nativeTapAtMs,
    }),
    [
      nativeTapAtMs,
      nativeTapBlockers,
      nativeTapEnabled,
      nativeTapLead,
      nativeTapSerial,
      direction,
      directionLocked,
      dragThrowAcceleration,
      dragThrowVelocity,
      inputBlocked,
      jsSampleIndex,
      lastSampleAtMs,
      nativeActive,
      nativeInputReady,
      nativePagerId,
      nativeStockNextToken,
      nativeStockPreviousToken,
      progress,
      releasePending,
      started,
      startBookX,
      startX,
    ],
  );
}

/**
 * The pan reads every input-gating decision from shared values, so its
 * callbacks never change while a turn moves and the gesture object stays
 * stable across page turns.
 */
export function usePageTurnPanGesture({
  beginDrag,
  endDrag,
  markNativeGestureAccepted,
  pageTurnEffect,
  spreadMode,
  updateDrag,
  values,
  viewport,
}: PageTurnPanGestureOptions): PanGesture {
  const viewportWidth = viewport?.width ?? 1;
  const visualKind = pageTurnEffect.visual.kind;
  const getGestureStartBookX = pageTurnEffect.gesture.getStartBookX;
  const getGestureGeometry = pageTurnEffect.gesture.getGeometry;
  const renderGestureProgress = pageTurnEffect.gesture.renderProgress;
  const nativeGesturePolicy = pageTurnEffect.native?.gesture;
  const nativeGestureEnabled = nativeGesturePolicy !== undefined;

  /* eslint-disable react-hooks/immutability */
  const gesture = useMemo(() => {
    const {
      direction,
      directionLocked,
      dragThrowAcceleration,
      dragThrowVelocity,
      inputBlocked,
      jsSampleIndex,
      lastSampleAtMs,
      nativeActive,
      nativeInputReady,
      nativePagerId,
      nativeStockNextToken,
      nativeStockPreviousToken,
      progress,
      releasePending,
      started,
      startBookX,
      startX,
    } = values;

    // Helpers precede the callbacks that capture them: worklets capture their
    // closure when they are created.
    const lockDirection = (translationX: number): boolean => {
      'worklet';
      if (directionLocked.value) return true;
      if (Math.abs(translationX) < 2) return false;
      const lockedDirection: 1 | -1 = translationX < 0 ? 1 : -1;
      direction.value = lockedDirection;
      directionLocked.value = true;
      const leaf = pageTurnLeaf(visualKind, spreadMode, viewportWidth, lockedDirection);
      startBookX.value = getGestureStartBookX(startX.value - leaf.offset, lockedDirection, leaf.width);
      return true;
    };

    /** Samples the drag on the sheet it turns; returns the finger's position on that sheet. */
    const applyPose = (translationX: number): number => {
      'worklet';
      const activeDirection = direction.value;
      const leaf = pageTurnLeaf(visualKind, spreadMode, viewportWidth, activeDirection);
      const geometry = getGestureGeometry({
        startBookX: startBookX.value,
        translationX,
        direction: activeDirection,
        pageWidth: leaf.width,
      });
      progress.value = renderGestureProgress({
        physicalProgress: planarTurnProgressForTranslation(translationX, activeDirection, leaf.width),
        direction: activeDirection,
        spreadMode,
      });
      return geometry.fingerX;
    };

    const sendSample = (translationX: number, absoluteY: number) => {
      'worklet';
      scheduleOnRN(updateDrag, translationX, absoluteY, dragThrowVelocity.value, dragThrowAcceleration.value);
    };

    // A pair stocked while the reader was idle lets the composer own the drag
    // from the first frame that has a direction. The sample sent just before
    // this always reaches RN first, so RN has already claimed the drag when
    // the acceptance arrives.
    const driveNative = (fingerX: number) => {
      'worklet';
      if (nativeActive.value) {
        updateNativePagerGestureOnUI(nativePagerId.value, { fingerX, turnProgress: progress.value });
        return;
      }
      const stockToken = direction.value > 0 ? nativeStockNextToken.value : nativeStockPreviousToken.value;
      if (
        !nativeGestureEnabled ||
        !nativeGesturePolicy ||
        !nativeInputReady.value ||
        stockToken <= 0 ||
        !nativeGesturePolicy.canStart(direction.value, startBookX.value)
      ) {
        return;
      }
      const accepted = beginNativePagerGestureOnUI(nativePagerId.value, {
        direction: direction.value,
        startBookX: startBookX.value,
        fingerX,
        turnProgress: progress.value,
      });
      if (accepted !== true) return;
      nativeActive.value = true;
      if (direction.value > 0) nativeStockNextToken.value = 0;
      else nativeStockPreviousToken.value = 0;
      scheduleOnRN(markNativeGestureAccepted, stockToken);
    };

    return Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-20, 20])
      .maxPointers(1)
      .cancelsTouchesInView(true)
      .onStart((event) => {
        'worklet';
        if (inputBlocked.value || releasePending.value) {
          started.value = false;
          return;
        }
        started.value = true;
        directionLocked.value = false;
        direction.value = 1;
        startX.value = event.x - event.translationX;
        startBookX.value = 1;
        progress.value = 0;
        nativeActive.value = false;
        dragThrowVelocity.value = 0;
        dragThrowAcceleration.value = 0;
        lastSampleAtMs.value = gestureSampleClockMs();
        jsSampleIndex.value = 0;
        scheduleOnRN(beginDrag, event.x - event.translationX, event.y - event.translationY);
        // Recognition already includes horizontal travel, so the turn can
        // take its direction and start preparing on this very event.
        if (!lockDirection(event.translationX)) return;
        const fingerX = applyPose(event.translationX);
        // Recognition measured this travel too, so its pan velocity seeds
        // the track instead of being blended in from rest.
        dragThrowVelocity.value = directedThrowVelocity(event.velocityX, direction.value, viewportWidth);
        jsSampleIndex.value = 1;
        sendSample(event.translationX, event.absoluteY);
        driveNative(fingerX);
      })
      .onUpdate((event) => {
        'worklet';
        if (!started.value) return;
        const newlyLocked = !directionLocked.value;
        if (!lockDirection(event.translationX)) return;
        const fingerX = applyPose(event.translationX);
        const sampledAtMs = gestureSampleClockMs();
        const sampleSeconds = (sampledAtMs - lastSampleAtMs.value) / 1000;
        const previousThrowVelocity = dragThrowVelocity.value;
        dragThrowVelocity.value = trackThrowVelocity(
          previousThrowVelocity,
          event.velocityX,
          direction.value,
          viewportWidth,
          sampleSeconds,
        );
        dragThrowAcceleration.value = trackThrowAcceleration(
          dragThrowAcceleration.value,
          previousThrowVelocity,
          dragThrowVelocity.value,
          sampleSeconds,
        );
        lastSampleAtMs.value = sampledAtMs;
        // The shared values above drive every drawn frame. JavaScript only
        // needs periodic samples for preparation and release prediction, and
        // none once native owns the intermediate frames; onEnd still sends the
        // final sample.
        jsSampleIndex.value += 1;
        if (!nativeActive.value && (newlyLocked || jsSampleIndex.value % 2 === 0)) {
          sendSample(event.translationX, event.absoluteY);
        }
        driveNative(fingerX);
      })
      .onEnd((event) => {
        'worklet';
        if (!started.value) return;
        releasePending.value = true;
        const activeDirection = direction.value;
        const fingerX = applyPose(event.translationX);
        const releaseTuning = nativeGesturePolicy?.getReleaseTuning(activeDirection, spreadMode);
        const leaf = pageTurnLeaf(visualKind, spreadMode, viewportWidth, activeDirection);
        // A finger that rested before lifting has spent its throw. The final
        // pan velocity still sets the release, so a last-moment flick back
        // toward the source can cancel the turn.
        const idleDecay = releaseIdleDecay(
          (gestureSampleClockMs() - lastSampleAtMs.value) / 1000,
          releaseTuning?.idleDecaySeconds ?? GESTURE_RELEASE_IDLE_DECAY_SECONDS,
        );
        const release: PageTurnReleaseSample = {
          throwVelocity: directedThrowVelocity(event.velocityX, activeDirection, viewportWidth) * idleDecay,
          throwAcceleration: dragThrowAcceleration.value * idleDecay,
          idleDecay,
        };
        let nativeReleased = false;
        if (nativeActive.value) {
          updateNativePagerGestureOnUI(nativePagerId.value, { fingerX, turnProgress: progress.value });
          // The native pager decides a single-page release, so it is handed
          // the same sample the JavaScript decision reads. Its own idle clock
          // restarts at the update above, so the decay applied here is the
          // only one.
          nativeReleased =
            endNativePagerGestureOnUI(nativePagerId.value, {
              fingerX,
              pageWidth: leaf.width,
              throwVelocity: release.throwVelocity,
              throwAcceleration: release.throwAcceleration,
              pageWeight: releaseTuning?.pageWeight ?? 1,
              commitThreshold: releaseTuning?.commitThreshold ?? 0.5,
              slowCommitEdgeX: releaseTuning?.slowCommitEdgeX ?? 0,
              minimumSpeedScale: releaseTuning?.minimumSpeedScale ?? 1,
              maximumSpeedScale: releaseTuning?.maximumSpeedScale ?? 1,
              velocityGain: releaseTuning?.velocityGain ?? 0,
              idleDecaySeconds: releaseTuning?.idleDecaySeconds ?? 0,
              releaseProjectionSeconds: releaseTuning?.releaseProjectionSeconds ?? 0,
            }) === true;
          nativeActive.value = false;
        }
        started.value = false;
        directionLocked.value = false;
        sendSample(event.translationX, event.absoluteY);
        scheduleOnRN(endDrag, event.velocityX, event.translationX, nativeReleased, release);
      })
      .onFinalize(() => {
        'worklet';
        if (!started.value) return;
        releasePending.value = true;
        const nativeCancelled = nativeActive.value && cancelNativePagerGestureOnUI(nativePagerId.value) === true;
        nativeActive.value = false;
        started.value = false;
        directionLocked.value = false;
        scheduleOnRN(endDrag, 0, Number.NaN, nativeCancelled);
      });
  }, [
    beginDrag,
    endDrag,
    getGestureGeometry,
    getGestureStartBookX,
    markNativeGestureAccepted,
    nativeGestureEnabled,
    nativeGesturePolicy,
    renderGestureProgress,
    spreadMode,
    updateDrag,
    values,
    viewportWidth,
    visualKind,
  ]);
  /* eslint-enable react-hooks/immutability */

  return gesture;
}
