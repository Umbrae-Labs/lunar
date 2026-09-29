import type {
  ReaderNativePageTurnMotionConfig,
  ReaderNativePlanarPageTurnMotionTuning,
} from '../../core/page-turn-effect';

const SLIDE_MOTION_TUNING = {
  releaseX: 1,
  liftVelocity: 1,
  liftToLeft: 1,
  curvatureRelaxation: 1,
} as const;

export const NATIVE_SLIDE_MOTION_CONFIG: ReaderNativePageTurnMotionConfig = {
  automatic: {
    forward: SLIDE_MOTION_TUNING,
    backward: SLIDE_MOTION_TUNING,
  },
  rapid: {
    forward: SLIDE_MOTION_TUNING,
    backward: SLIDE_MOTION_TUNING,
  },
  gesture: {
    forward: SLIDE_MOTION_TUNING,
    backward: SLIDE_MOTION_TUNING,
  },
};

export const NATIVE_SLIDE_PLANAR_MOTION: ReaderNativePlanarPageTurnMotionTuning = {
  minimumReleaseSpeedPxPerMs: 0.2,
  maximumReleaseSpeedPxPerMs: 1,
  maximumPlaybackRate: 4,
  minimumBoostedSettleMs: 60,
  maximumEaseOutBlend: 0.75,
};
