import type { ReaderPageTurnEffect, ReaderPageTurnReleaseContext } from '../../core/page-turn-effect';
import { clampUnit } from '../../core/page-turn-math';
import { NATIVE_CURL_MOTION_CONFIG } from './native-motion';
import {
  anchoredGestureFingerX,
  bookXForGestureTravel,
  gestureLiftRotationForFingerX,
  gesturePressedChordForFingerX,
  MIN_PRESSED_EDGE_X,
  pageTurnStartBookXForTouch,
  postHingeTurnProgressForFingerX,
  SLOW_COMMIT_EDGE_X,
  turnCommitScore,
} from './gesture';
import { gestureSinglePreviousCurlProgress, gestureSinglePreviousCurlRemainingDurationMs } from './progress';

export const AUTOMATIC_PAGE_TURN_DURATION_MS = 947;
export const PAGE_TURN_DURATION_MS = AUTOMATIC_PAGE_TURN_DURATION_MS;
export const PAGE_TURN_GESTURE_SETTLE_DURATION_MS = 520;
export const PAGE_TURN_REVERSE_DURATION_MS = 854;
export const PAGE_TURN_REVERT_DURATION_MS = 720;

const GESTURE_FORWARD_COMMIT_THRESHOLD = 0.8;
// The forward threshold is measured in book units of the physical page, which
// a spread makes half of the interaction width: a slow drag commits once the
// sheet has carried 0.8 * (1 - SLOW_COMMIT_EDGE_X) of its own width, about the
// half screen a spread hand already travels. A single page is the whole
// interaction width, so that same threshold asked for a full screen of travel,
// while the incoming reveal — scored in turn progress — committed after 0.11.
//
// Both single-page thresholds are rebalanced onto the spread's travel: the
// forward commit lands on 0.49 interaction widths and the reveal on 0.36, and
// a release with throw speed shortens the two by the same amount.
const SINGLE_FORWARD_COMMIT_THRESHOLD = 0.4;
const SINGLE_BACKWARD_COMMIT_THRESHOLD = 0.5;
const GESTURE_FORWARD_MINIMUM_SPEED_SCALE = 1;
const GESTURE_BACKWARD_MINIMUM_SPEED_SCALE = 0.8;
const GESTURE_MAXIMUM_SPEED_SCALE = 5;
const GESTURE_VELOCITY_GAIN = 0.8;
const GESTURE_IDLE_DECAY_SECONDS = 0.1;
const PAGE_TURN_PROPAGATION_SPEED_SCALE = 1.15;

/**
 * Commit score a release has to reach. The gesture effect and the native pager
 * policy must agree on this, because a single-page drag is decided by whichever
 * of the two owns it.
 *
 * Declared above the effect on purpose: the worklets plugin reads a worklet's
 * captured bindings the moment the effect literal is evaluated, so a worklet
 * helper declared below it would be captured while still uninitialized.
 */
function curlGestureCommitThreshold(direction: 1 | -1, spreadMode: ReaderPageTurnReleaseContext['spreadMode']): number {
  'worklet';
  if (spreadMode !== 'single') return GESTURE_FORWARD_COMMIT_THRESHOLD;
  return direction === -1 ? SINGLE_BACKWARD_COMMIT_THRESHOLD : SINGLE_FORWARD_COMMIT_THRESHOLD;
}

export const curlPageTurnEffect: ReaderPageTurnEffect = {
  style: 'page',
  visual: {
    kind: 'curl',
    isIncomingPageLanding: (direction, spreadMode) => spreadMode === 'single' && direction === -1,
    getPrimaryTransform: () => {
      'worklet';
      return [];
    },
    getIncomingTransform: () => {
      'worklet';
      return [];
    },
    getOutgoingTransform: () => {
      'worklet';
      return [];
    },
  },
  gesture: {
    getStartBookX: pageTurnStartBookXForTouch,
    getGeometry: ({ startBookX, translationX, direction, pageWidth }) => {
      'worklet';
      const currentBookX = bookXForGestureTravel(startBookX, translationX, direction, pageWidth);
      const fingerX = anchoredGestureFingerX(startBookX, currentBookX);
      const heldRollTilt = gestureLiftRotationForFingerX(fingerX);
      return {
        fingerX,
        heldRollTilt,
        pressedEdgeX: gesturePressedChordForFingerX(fingerX, heldRollTilt),
      };
    },
    renderProgress: ({ physicalProgress, direction, spreadMode }) => {
      'worklet';
      const progress = clampUnit(physicalProgress);
      if (spreadMode !== 'single') return progress;
      return direction === 1 ? progress * 0.5 : gestureSinglePreviousCurlProgress(progress);
    },
    shouldCommit: ({
      progress,
      towardTargetVelocity,
      direction,
      spreadMode,
      startBookX,
      fingerX,
      throwVelocity,
      throwAcceleration,
    }) => {
      'worklet';
      const incomingPage = spreadMode === 'single' && direction === -1;
      const commitFingerX = incomingPage ? 1 - clampUnit(progress) * (1 - SLOW_COMMIT_EDGE_X) : fingerX;
      const score = turnCommitScore(commitFingerX, Math.max(throwVelocity, towardTargetVelocity), throwAcceleration);
      return (incomingPage || startBookX >= 0.25) && score >= curlGestureCommitThreshold(direction, spreadMode);
    },
  },
  native: {
    visualKind: 'curl',
    motion: NATIVE_CURL_MOTION_CONFIG,
    gesture: {
      minimumStartBookX: 0.25,
      canStart: (direction, startBookX) => {
        'worklet';
        return direction < 0 || startBookX >= 0.25;
      },
      getReleaseTuning: (direction, spreadMode) => {
        'worklet';
        return {
          pageWeight: 1,
          commitThreshold: curlGestureCommitThreshold(direction, spreadMode),
          slowCommitEdgeX: SLOW_COMMIT_EDGE_X,
          minimumSpeedScale:
            direction === -1 ? GESTURE_BACKWARD_MINIMUM_SPEED_SCALE : GESTURE_FORWARD_MINIMUM_SPEED_SCALE,
          maximumSpeedScale: GESTURE_MAXIMUM_SPEED_SCALE,
          velocityGain: GESTURE_VELOCITY_GAIN,
          idleDecaySeconds: GESTURE_IDLE_DECAY_SECONDS,
          releaseProjectionSeconds: 0,
        };
      },
    },
  },
  motion: {
    getDuration: ({ incomingPageLanding }) =>
      incomingPageLanding ? PAGE_TURN_REVERSE_DURATION_MS : PAGE_TURN_DURATION_MS,
    getSettleDuration: getCurlSettleDuration,
    getAutomaticDuration: ({ incomingPageLanding }) =>
      incomingPageLanding ? PAGE_TURN_REVERSE_DURATION_MS : PAGE_TURN_DURATION_MS,
    getEasing: ({ fromProgress, targetProgress, incomingPageLanding, interactive }) => {
      if (!interactive) return linear;
      if (targetProgress === 0) return easeOutCubic;
      return incomingPageLanding ? incomingGestureSettleEasing(fromProgress) : linear;
    },
  },
  orchestration: {
    serializesAutomaticTurns: true,
    usesAutomaticTransition: true,
    usesPlanarAutomaticTransition: false,
  },
};

function linear(progress: number): number {
  'worklet';
  return progress;
}

function easeOutCubic(progress: number): number {
  'worklet';
  return 1 - (1 - progress) ** 3;
}

function incomingGestureSettleEasing(startProgress: number) {
  const start = clampUnit(startProgress);
  const revealEnd = 0.1;
  const durationScale = 0.7 / (1 - revealEnd);
  const preludeRemaining = start < revealEnd ? (revealEnd - start) * durationScale : 0;
  const landingStart = Math.max(start, revealEnd);
  const landingDuration = (1 - landingStart) * durationScale;
  const totalDuration = preludeRemaining + landingDuration;

  return (timelineProgress: number): number => {
    'worklet';
    if (start >= 1) return 1;
    const elapsed = clampUnit(timelineProgress) * totalDuration;
    let drivenProgress: number;
    if (preludeRemaining > 0 && elapsed < preludeRemaining) {
      drivenProgress = start + (revealEnd - start) * (elapsed / preludeRemaining);
    } else {
      const landingElapsed = Math.max(0, elapsed - preludeRemaining);
      const linearProgress = clampUnit(landingElapsed / Math.max(0.000001, landingDuration));
      const easedProgress = 1 - (1 - linearProgress) ** 2;
      drivenProgress = landingStart + (1 - landingStart) * easedProgress;
    }
    return clampUnit((drivenProgress - start) / Math.max(0.000001, 1 - start));
  };
}

function getCurlSettleDuration({
  fromProgress,
  targetProgress,
  throwVelocity,
  direction,
  spreadMode,
  fingerX,
  pressedEdgeX,
  heldRollTilt,
  startBookX,
}: Parameters<ReaderPageTurnEffect['motion']['getSettleDuration']>[0]): number {
  const progress = clampUnit(fromProgress);
  const incomingPage = spreadMode === 'single' && direction === -1;
  if (targetProgress === 0) {
    return Math.max(1000 / 60, Math.round(incomingPage ? 700 * progress : PAGE_TURN_REVERT_DURATION_MS * progress));
  }

  const minimumSpeed = direction === -1 ? GESTURE_BACKWARD_MINIMUM_SPEED_SCALE : GESTURE_FORWARD_MINIMUM_SPEED_SCALE;
  const speedScale = Math.min(
    GESTURE_MAXIMUM_SPEED_SCALE,
    Math.max(minimumSpeed, minimumSpeed + Math.max(0, throwVelocity) * GESTURE_VELOCITY_GAIN),
  );
  if (incomingPage) {
    return Math.max(1000 / 60, Math.round(gestureSinglePreviousCurlRemainingDurationMs(progress) / speedScale));
  }

  const turnProgress = postHingeTurnProgressForFingerX(fingerX, startBookX, 10);
  const remainingRotationRatio = (Math.PI - Math.max(0, heldRollTilt)) / Math.PI;
  const fullDurationSeconds =
    ((Math.min(1, Math.max(MIN_PRESSED_EDGE_X, pressedEdgeX)) + 1) * remainingRotationRatio) /
    (PAGE_TURN_PROPAGATION_SPEED_SCALE * speedScale);
  return Math.max(1000 / 60, Math.round(1000 * (1 - turnProgress) * fullDurationSeconds));
}
