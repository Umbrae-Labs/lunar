import type { ReaderNativePageTurnMotionConfig, ReaderNativePageTurnMotionTuning } from '../../core/page-turn-effect';

const AUTOMATIC_FORWARD_TUNING: ReaderNativePageTurnMotionTuning = {
  releaseX: 0.9,
  liftVelocity: 0.5,
  liftToLeft: 4,
  curvatureRelaxation: 10,
};

const AUTOMATIC_BACKWARD_TUNING: ReaderNativePageTurnMotionTuning = {
  releaseX: 0.4,
  liftVelocity: 0.5,
  liftToLeft: 4,
  curvatureRelaxation: 10,
  incomingLandingStartProgress: 0.15,
  incomingRevealStartProgress: 0,
  incomingRevealEndProgress: 0.18,
  incomingDragProgressScale: 1,
  incomingDragProgressExponent: 1,
  incomingSettleDurationSeconds: 0.7,
  incomingSettleEasingPower: 3,
  incomingRevertDurationSeconds: 0.72,
};

const GESTURE_FORWARD_TUNING: ReaderNativePageTurnMotionTuning = {
  releaseX: 0.4,
  liftVelocity: 1,
  liftToLeft: 1,
  curvatureRelaxation: 10,
};

const GESTURE_BACKWARD_TUNING: ReaderNativePageTurnMotionTuning = {
  releaseX: 0.6,
  liftVelocity: 1,
  liftToLeft: 1,
  curvatureRelaxation: 10,
  incomingLandingStartProgress: 0.15,
  incomingRevealStartProgress: 0,
  incomingRevealEndProgress: 0.1,
  incomingDragProgressScale: 1,
  incomingDragProgressExponent: 1,
  incomingSettleDurationSeconds: 0.7,
  incomingSettleEasingPower: 2,
  incomingRevertDurationSeconds: 0.7,
};

export const NATIVE_CURL_MOTION_CONFIG: ReaderNativePageTurnMotionConfig = {
  automatic: {
    forward: AUTOMATIC_FORWARD_TUNING,
    backward: AUTOMATIC_BACKWARD_TUNING,
  },
  rapid: {
    forward: AUTOMATIC_FORWARD_TUNING,
    backward: AUTOMATIC_BACKWARD_TUNING,
  },
  gesture: {
    forward: GESTURE_FORWARD_TUNING,
    backward: GESTURE_BACKWARD_TUNING,
  },
};
