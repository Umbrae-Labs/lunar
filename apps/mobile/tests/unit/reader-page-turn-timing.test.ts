import { describe, expect, it } from 'vitest';

import { AUTOMATIC_PLANAR_PAGE_TURN_MIN_DURATION_MS } from '../../src/reader/skia/anime/core/page-turn-math';
import { nonePageTurnEffect } from '../../src/reader/skia/anime/effects/none/strategy';
import {
  curlPageTurnEffect,
  PAGE_TURN_DURATION_MS,
} from '../../src/reader/skia/anime/effects/curl/strategy';
import { getReaderPageTurnEffect } from '../../src/reader/skia/anime/effects/page-turn-effects';
import {
  getSlidePageTurnEasing,
  SLIDE_RELEASE_PROJECTION_SECONDS,
  slidePageTurnEffect,
} from '../../src/reader/skia/anime/effects/slide/strategy';

describe('reader page turn effect timing', () => {
  it('keeps curl animations on their fixed duration', () => {
    expect(curlPageTurnEffect.motion.getDuration({
      releaseVelocity: 6,
      animationDuration: 360,
      incomingPageLanding: false,
    })).toBe(PAGE_TURN_DURATION_MS);
    expect(curlPageTurnEffect.motion.getDuration({
      releaseVelocity: 0,
      animationDuration: 360,
      incomingPageLanding: true,
    })).toBe(854);
  });

  it('shortens planar animations according to release speed', () => {
    expect(slidePageTurnEffect.motion.getDuration({
      releaseVelocity: 0,
      animationDuration: 360,
      incomingPageLanding: false,
    })).toBe(360);
    expect(slidePageTurnEffect.motion.getDuration({
      releaseVelocity: 2,
      animationDuration: 360,
      incomingPageLanding: false,
    })).toBe(302);
    expect(nonePageTurnEffect.motion.getDuration({
      releaseVelocity: 20,
      animationDuration: 360,
      incomingPageLanding: false,
    })).toBe(0);
  });

  it('resolves compatibility names to one effect instance', () => {
    expect(getReaderPageTurnEffect('none')).toBe(nonePageTurnEffect);
    expect(getReaderPageTurnEffect('overlay')).toBe(nonePageTurnEffect);
    expect(getReaderPageTurnEffect('pageCurl')).toBe(curlPageTurnEffect);
    expect(getReaderPageTurnEffect('simulation')).toBe(curlPageTurnEffect);
    expect(getReaderPageTurnEffect('slide')).toBe(slidePageTurnEffect);
    expect(slidePageTurnEffect.motion.getDuration({
      releaseVelocity: 0,
      animationDuration: Number.NaN,
      incomingPageLanding: false,
    })).toBe(360);
  });

  it('keeps visual calculations and native capability in each effect', () => {
    expect(slidePageTurnEffect.visual.getIncomingTransform({
      direction: 1,
      width: 400,
      progress: 0.25,
    })).toEqual([{ translateX: 300 }]);
    expect(slidePageTurnEffect.visual.getOutgoingTransform({
      direction: -1,
      width: 400,
      progress: 0.25,
    })).toEqual([{ translateX: 100 }]);
    expect(nonePageTurnEffect.visual.getPrimaryTransform({
      direction: 1,
      width: 400,
      progress: 0.25,
    })).toEqual([]);
    expect(curlPageTurnEffect.visual.isIncomingPageLanding(-1, 'single')).toBe(true);
    expect(curlPageTurnEffect.native?.motion.automatic.backward)
      .toMatchObject({ incomingRevertDurationSeconds: 0.72 });
    expect(curlPageTurnEffect.native?.motion.gesture.forward).toEqual({
      releaseX: 0.4,
      liftVelocity: 1,
      liftToLeft: 1,
      curvatureRelaxation: 10,
    });
    expect(curlPageTurnEffect.native?.motion.gesture.backward).toMatchObject({
      releaseX: 0.6,
      incomingRevealEndProgress: 0.1,
      incomingSettleDurationSeconds: 0.7,
      incomingSettleEasingPower: 2,
      incomingRevertDurationSeconds: 0.7,
    });
    expect(curlPageTurnEffect.native?.gesture.getReleaseTuning(1, 'single'))
      .toMatchObject({
        commitThreshold: 0.4,
        minimumSpeedScale: 1,
        maximumSpeedScale: 5,
        velocityGain: 0.8,
        idleDecaySeconds: 0.1,
      });
    expect(curlPageTurnEffect.native?.gesture.getReleaseTuning(-1, 'single'))
      .toMatchObject({
        commitThreshold: 0.5,
        minimumSpeedScale: 0.8,
      });
    // A spread keeps the Persimmon tunings; only a single page rebalances them.
    expect(curlPageTurnEffect.native?.gesture.getReleaseTuning(1, 'double'))
      .toMatchObject({ commitThreshold: 0.8 });
    expect(slidePageTurnEffect.native).toMatchObject({
      visualKind: 'slide',
      planarMotion: {
        minimumReleaseSpeedPxPerMs: 0.2,
        maximumReleaseSpeedPxPerMs: 1,
        maximumPlaybackRate: 4,
        minimumBoostedSettleMs: 60,
        maximumEaseOutBlend: 0.75,
      },
    });
    expect(slidePageTurnEffect.native?.gesture.canStart(1, 0)).toBe(true);
    expect(slidePageTurnEffect.native?.gesture.getReleaseTuning(1, 'single'))
      .toMatchObject({
        commitThreshold: 0.5,
        releaseProjectionSeconds: SLIDE_RELEASE_PROJECTION_SECONDS,
      });
  });

  it('lets each effect calculate its release and rebound duration', () => {
    expect(slidePageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.7,
      targetProgress: 1,
      releaseVelocity: 0,
      throwVelocity: 0,
      animationDuration: 360,
      pageWidth: 0,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0.3,
      pressedEdgeX: 0.3,
      heldRollTilt: 0,
      startBookX: 1,
    })).toBe(108);
    expect(slidePageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.7,
      targetProgress: 0,
      releaseVelocity: 0,
      throwVelocity: 0,
      animationDuration: 360,
      pageWidth: 0,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0.3,
      pressedEdgeX: 0.3,
      heldRollTilt: 0,
      startBookX: 1,
    })).toBe(252);
    expect(slidePageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.95,
      targetProgress: 1,
      releaseVelocity: 4,
      throwVelocity: 4,
      animationDuration: 360,
      pageWidth: 400,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0.3,
      pressedEdgeX: 0.3,
      heldRollTilt: 0,
      startBookX: 1,
    })).toBe(18);
    expect(slidePageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.5,
      targetProgress: 1,
      releaseVelocity: 3.75,
      throwVelocity: 3.75,
      animationDuration: 1000,
      pageWidth: 400,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0.3,
      pressedEdgeX: 0.3,
      heldRollTilt: 0,
      startBookX: 1,
    })).toBe(125);
    expect(slidePageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.5,
      targetProgress: 1,
      releaseVelocity: -3.75,
      throwVelocity: 0,
      animationDuration: 1000,
      pageWidth: 400,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0.3,
      pressedEdgeX: 0.3,
      heldRollTilt: 0,
      startBookX: 1,
    })).toBe(500);
    expect(curlPageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.5,
      targetProgress: 1,
      releaseVelocity: 0,
      throwVelocity: 0,
      animationDuration: 360,
      pageWidth: 400,
      direction: 1,
      spreadMode: 'single',
      fingerX: 0,
      pressedEdgeX: 0.15148003824552042,
      heldRollTilt: 0.3918236689953761,
      startBookX: 1,
    })).toBe(798);
    expect(curlPageTurnEffect.motion.getSettleDuration({
      fromProgress: 0.5,
      targetProgress: 1,
      releaseVelocity: 0,
      throwVelocity: 0,
      animationDuration: 360,
      pageWidth: 400,
      direction: -1,
      spreadMode: 'single',
      fingerX: 0.5,
      pressedEdgeX: 0.5,
      heldRollTilt: 0,
      startBookX: 0.5,
    })).toBe(486);
  });

  it('uses the Readest slide curve when settling without release momentum', () => {
    const easing = getSlidePageTurnEasing(0.5, 1);

    expect(easing(0)).toBe(0);
    expect(easing(0.25)).toBeCloseTo(0.125);
    expect(easing(0.5)).toBe(0.5);
    expect(easing(0.75)).toBeCloseTo(0.875);
    expect(easing(1)).toBe(1);
  });

  it('finishes a fast short swipe promptly while preserving slow drag and rebound timing', () => {
    const context = {
      fromProgress: 0.2, targetProgress: 1 as const, releaseVelocity: 4, throwVelocity: 4,
      animationDuration: 360, pageWidth: 400, direction: 1 as const, spreadMode: 'single' as const,
      fingerX: 0.6, pressedEdgeX: 0.4, heldRollTilt: 0.3, startBookX: 1,
    };
    expect(slidePageTurnEffect.motion.getSettleDuration(context)).toBe(72);
    expect(slidePageTurnEffect.motion.getSettleDuration({ ...context, releaseVelocity: 0 })).toBe(288);
    for (const direction of [1, -1] as const) {
      const slow = curlPageTurnEffect.motion.getSettleDuration({ ...context, direction, throwVelocity: 0 });
      const fast = curlPageTurnEffect.motion.getSettleDuration({ ...context, direction });
      expect(fast).toBeLessThan(slow / 3);
      expect(fast).toBeGreaterThanOrEqual(1000 / 60);
      expect(curlPageTurnEffect.motion.getSettleDuration({ ...context, direction, targetProgress: 0 }))
        .toBe(curlPageTurnEffect.motion.getSettleDuration({ ...context, direction, targetProgress: 0, throwVelocity: 0 }));
    }
  });

  it('uses Persimmon curl release curves', () => {
    const forward = curlPageTurnEffect.motion.getEasing({
      fromProgress: 0.5,
      targetProgress: 1,
      releaseVelocityPxPerMs: 0,
      incomingPageLanding: false,
      interactive: true,
    });
    const backward = curlPageTurnEffect.motion.getEasing({
      fromProgress: 0,
      targetProgress: 1,
      releaseVelocityPxPerMs: 0,
      incomingPageLanding: true,
      interactive: true,
    });

    expect(forward(0.5)).toBe(0.5);
    expect(backward(0.1)).toBeCloseTo(0.1);
    expect(backward(0.5)).toBeCloseTo(0.7222222222);
  });

  it('blends toward ease-out only when release momentum points at the target', () => {
    const towardTarget = getSlidePageTurnEasing(0.5, 1, 1);
    const awayFromTarget = getSlidePageTurnEasing(0.5, 1, -1);
    const returning = getSlidePageTurnEasing(0.5, 0, -1);

    expect(towardTarget(0.25)).toBeCloseTo(0.46484375);
    expect(awayFromTarget(0.25)).toBeCloseTo(0.125);
    expect(returning(0.25)).toBeCloseTo(0.46484375);
  });

  it('accelerates queued planar turns without restarting completed progress', () => {
    const duration = (queuedTurnCount: number, fromProgress: number) =>
      slidePageTurnEffect.motion.getAutomaticDuration({
        queuedTurnCount,
        fromProgress,
        animationDuration: 360,
        incomingPageLanding: false,
      });

    expect(duration(1, 0)).toBe(360);
    expect(duration(2, 0)).toBe(180);
    expect(duration(4, 0)).toBe(AUTOMATIC_PLANAR_PAGE_TURN_MIN_DURATION_MS);
    expect(duration(4, 0.5)).toBe(50);
  });
});
