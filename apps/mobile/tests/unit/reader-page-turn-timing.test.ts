import { describe, expect, it } from 'vitest';

import { nonePageTurnEffect } from '../../src/reader/skia/anime/effects/none/strategy';
import {
  curlPageTurnEffect,
  PAGE_TURN_DURATION_MS,
} from '../../src/reader/skia/anime/effects/curl/strategy';
import { getReaderPageTurnEffect } from '../../src/reader/skia/anime/effects/page-turn-effects';
import {
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

  it('keeps native capability in each effect', () => {
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
});
