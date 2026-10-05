import type { ReaderPageTurnEffect } from '../../core/page-turn-effect';
import { clampUnit, crossesPageTurnCommitThreshold } from '../../core/page-turn-math';

/** A page switch that keeps the current page still until the runtime publishes the target. */
export const nonePageTurnEffect: ReaderPageTurnEffect = {
  style: 'none',
  visual: {
    kind: 'none',
    isIncomingPageLanding: () => false,
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
      return crossesPageTurnCommitThreshold(progress, towardTargetVelocity);
    },
  },
  motion: {
    getDuration: () => 0,
    getSettleDuration: () => 0,
    getAutomaticDuration: () => 0,
    getEasing: () => linear,
  },
  orchestration: {
    serializesAutomaticTurns: false,
    usesAutomaticTransition: false,
    usesPlanarAutomaticTransition: false,
  },
};

function linear(progress: number): number {
  'worklet';
  return progress;
}
