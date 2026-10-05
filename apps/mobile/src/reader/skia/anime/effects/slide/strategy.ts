import type { ReaderPageTurnEffect } from '../../core/page-turn-effect';
import {
  clampPageTurnDuration,
  clampUnit,
  crossesPageTurnCommitThreshold,
  getPlanarAutomaticPageTurnDuration,
} from '../../core/page-turn-math';
import { NATIVE_SLIDE_MOTION_CONFIG, NATIVE_SLIDE_PLANAR_MOTION } from './native-motion';

export const SLIDE_RELEASE_PROJECTION_SECONDS = 0.24;

const {
  minimumReleaseSpeedPxPerMs: RELEASE_MIN_SPEED_PX_PER_MS,
  maximumReleaseSpeedPxPerMs: RELEASE_MAX_SPEED_PX_PER_MS,
  maximumPlaybackRate: MAX_PLAYBACK_RATE,
  minimumBoostedSettleMs: MIN_BOOSTED_SETTLE_MS,
  maximumEaseOutBlend: MAX_EASE_OUT_BLEND,
} = NATIVE_SLIDE_PLANAR_MOTION;

export const slidePageTurnEffect: ReaderPageTurnEffect = {
  style: 'slide',
  visual: {
    kind: 'slide',
    isIncomingPageLanding: () => false,
    getPrimaryTransform: () => {
      'worklet';
      return [];
    },
    getIncomingTransform: ({ direction, width, progress }) => {
      'worklet';
      return [{ translateX: direction * width * (1 - progress) }];
    },
    getOutgoingTransform: ({ direction, width, progress }) => {
      'worklet';
      return [{ translateX: -direction * width * progress }];
    },
  },
  gesture: {
    getStartBookX: (localX, direction, pageWidth) => {
      'worklet';
      const normalized = clampUnit(localX / Math.max(1, pageWidth));
      return direction === 1 ? normalized : 1 - normalized;
    },
    getGeometry: ({ translationX, direction, pageWidth }) => {
      'worklet';
      const distance = direction === 1 ? -translationX : translationX;
      return {
        fingerX: 1 - clampUnit(distance / Math.max(1, pageWidth)),
        heldRollTilt: 0,
        pressedEdgeX: 1,
      };
    },
    renderProgress: ({ physicalProgress }) => {
      'worklet';
      return clampUnit(physicalProgress);
    },
    shouldCommit: ({ progress, towardTargetVelocity }) => {
      'worklet';
      return crossesPageTurnCommitThreshold(progress, towardTargetVelocity, SLIDE_RELEASE_PROJECTION_SECONDS);
    },
  },
  native: {
    separateChrome: true,
    visualKind: 'slide',
    motion: NATIVE_SLIDE_MOTION_CONFIG,
    planarMotion: NATIVE_SLIDE_PLANAR_MOTION,
    gesture: {
      minimumStartBookX: 0,
      canStart: () => {
        'worklet';
        return true;
      },
      getReleaseTuning: () => {
        'worklet';
        return {
          pageWeight: 1,
          commitThreshold: 0.5,
          slowCommitEdgeX: 0,
          minimumSpeedScale: 1,
          maximumSpeedScale: 2,
          velocityGain: 0,
          idleDecaySeconds: 0.1,
          releaseProjectionSeconds: SLIDE_RELEASE_PROJECTION_SECONDS,
        };
      },
    },
  },
  motion: {
    getDuration: ({ releaseVelocity, animationDuration }) => {
      const releaseSpeed = Math.min(6, Math.max(0, releaseVelocity));
      const releaseBoost = Math.min(0.55, releaseSpeed * 0.08);
      return Math.max(140, Math.round(clampPageTurnDuration(animationDuration) * (1 - releaseBoost)));
    },
    getSettleDuration: ({ fromProgress, targetProgress, releaseVelocity, animationDuration, pageWidth }) => {
      const distance = Math.abs(clampUnit(targetProgress) - clampUnit(fromProgress));
      const baseDuration = clampPageTurnDuration(animationDuration) * distance;
      const releaseVelocityPxPerMs = (releaseVelocity * Math.max(0, pageWidth)) / 1000;
      const releaseBoost = getSlideReleaseBoost(fromProgress, targetProgress, releaseVelocityPxPerMs);
      if (releaseBoost <= 0) return Math.max(1, Math.round(baseDuration));

      const playbackRate = 1 + (MAX_PLAYBACK_RATE - 1) * releaseBoost;
      const duration = Math.max(Math.min(MIN_BOOSTED_SETTLE_MS, baseDuration), baseDuration / playbackRate);
      return Math.max(1, Math.round(duration));
    },
    getAutomaticDuration: ({ queuedTurnCount, fromProgress, animationDuration }) =>
      getPlanarAutomaticPageTurnDuration(
        queuedTurnCount,
        fromProgress,
        slidePageTurnEffect.motion.getDuration({
          releaseVelocity: 0,
          animationDuration,
          incomingPageLanding: false,
        }),
      ),
    getEasing: ({ fromProgress, targetProgress, releaseVelocityPxPerMs }) =>
      getSlidePageTurnEasing(fromProgress, targetProgress, releaseVelocityPxPerMs),
  },
  orchestration: {
    serializesAutomaticTurns: false,
    usesAutomaticTransition: true,
    usesPlanarAutomaticTransition: true,
  },
};

export function getSlidePageTurnEasing(
  fromProgress: number,
  targetProgress: 0 | 1,
  releaseVelocityPxPerMs = 0,
): (progress: number) => number {
  const releaseBoost = getSlideReleaseBoost(fromProgress, targetProgress, releaseVelocityPxPerMs);
  const easeOutBlend = releaseBoost * MAX_EASE_OUT_BLEND;

  return (progress: number): number => {
    'worklet';
    const time = clampUnit(progress);
    const easeInOutQuad = time < 0.5 ? 2 * time * time : 1 - 2 * (1 - time) * (1 - time);
    const easeOutCubic = 1 - (1 - time) ** 3;
    return easeInOutQuad * (1 - easeOutBlend) + easeOutCubic * easeOutBlend;
  };
}

function getSlideReleaseBoost(fromProgress: number, targetProgress: 0 | 1, releaseVelocityPxPerMs: number): number {
  const towardTarget = releaseVelocityPxPerMs * (targetProgress - fromProgress) > 0;
  if (!towardTarget) return 0;
  return clampUnit(
    (Math.abs(releaseVelocityPxPerMs) - RELEASE_MIN_SPEED_PX_PER_MS) /
      (RELEASE_MAX_SPEED_PX_PER_MS - RELEASE_MIN_SPEED_PX_PER_MS),
  );
}
