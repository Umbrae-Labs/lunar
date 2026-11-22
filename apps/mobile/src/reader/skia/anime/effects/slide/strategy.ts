import type { ReaderPageTurnEffect } from '../../core/page-turn-effect';
import { clampPageTurnDuration, clampUnit, crossesPageTurnCommitThreshold } from '../../core/page-turn-math';
import { NATIVE_SLIDE_MOTION_CONFIG, NATIVE_SLIDE_PLANAR_MOTION } from './native-motion';

export const SLIDE_RELEASE_PROJECTION_SECONDS = 0.24;

export const slidePageTurnEffect: ReaderPageTurnEffect = {
  style: 'slide',
  visual: {
    kind: 'slide',
    isIncomingPageLanding: () => false,
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
  },
};
