import type { ReaderPageTurnEffect, ReaderPageTurnReleaseContext } from '../../core/page-turn-effect';
import { clampUnit } from '../../core/page-turn-math';
import { NATIVE_CURL_MOTION_CONFIG } from './native-motion';
import {
  anchoredGestureFingerX,
  bookXForGestureTravel,
  gestureLiftRotationForFingerX,
  gesturePressedChordForFingerX,
  isWeakGripStart,
  pageTurnStartBookXForTouch,
  SLOW_COMMIT_EDGE_X,
  turnCommitScore,
  WEAK_GRIP_START_BOOK_X,
  weakGripPressedEdgeX,
} from './gesture';
import { gestureSinglePreviousCurlProgress } from './progress';
import { AUTOMATIC_PAGE_TURN_DURATION_MS } from './timing';

export { AUTOMATIC_PAGE_TURN_DURATION_MS } from './timing';
export const PAGE_TURN_DURATION_MS = AUTOMATIC_PAGE_TURN_DURATION_MS;
export const PAGE_TURN_REVERSE_DURATION_MS = 854;

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
  },
  gesture: {
    getStartBookX: pageTurnStartBookXForTouch,
    getGeometry: ({ startBookX, translationX, direction, pageWidth }) => {
      'worklet';
      const currentBookX = bookXForGestureTravel(startBookX, translationX, direction, pageWidth);
      const fingerX = anchoredGestureFingerX(startBookX, currentBookX);
      if (isWeakGripStart(startBookX)) {
        return { fingerX, heldRollTilt: 0, pressedEdgeX: weakGripPressedEdgeX(fingerX) };
      }
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
      return (
        (incomingPage || !isWeakGripStart(startBookX)) && score >= curlGestureCommitThreshold(direction, spreadMode)
      );
    },
  },
  native: {
    visualKind: 'curl',
    motion: NATIVE_CURL_MOTION_CONFIG,
    gesture: {
      minimumStartBookX: WEAK_GRIP_START_BOOK_X,
      canStart: (direction, startBookX) => {
        'worklet';
        return direction < 0 || !isWeakGripStart(startBookX);
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
  },
};
