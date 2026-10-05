import { describe, expect, it } from 'vitest';

import {
  gestureLiftRotationForFingerX,
  gesturePressedChordForFingerX,
} from '../../src/reader/skia/anime/effects/curl/gesture';
import {
  AUTOMATIC_PAGE_TURN_DURATION_MS,
  bendAmplitudeForChord,
  createAutomaticCurlProfile,
  createGestureCurlProfile,
} from '../../src/reader/skia/anime/effects/curl/geometry';

function profile(
  progress: number,
  overrides: Partial<Parameters<typeof createGestureCurlProfile>[0]> = {},
) {
  const direction = overrides.direction ?? 1;
  const spreadMode = overrides.spreadMode ?? 'double';
  const progressScale = spreadMode === 'single' && direction > 0 ? 2 : 1;
  const fingerX = 1 - Math.min(1, progress * progressScale);
  const heldRollTilt = gestureLiftRotationForFingerX(fingerX);
  return createGestureCurlProfile({
    progress,
    direction,
    startBookX: 0.9,
    pressedEdgeX: gesturePressedChordForFingerX(fingerX, heldRollTilt),
    heldRollTilt,
    spreadMode,
    settling: false,
    settleTo: 1,
    releaseProgress: progress,
    ...overrides,
  });
}

describe('gesture curl geometry', () => {
  it('uses the pressed chord as the elastica boundary before the hinge', () => {
    const flat = profile(0);
    const pressed = profile(0.4);

    expect(flat.amplitude).toBe(0);
    expect(pressed.amplitude).toBeCloseTo(bendAmplitudeForChord(0.6), 6);
    expect(pressed.rotation).toBe(0);
    expect(pressed.landedLength).toBe(0);
  });

  it('stays continuous where the pressed roll becomes a turning roll', () => {
    const atHinge = profile(0.8);
    const afterHinge = profile(0.800001);

    expect(afterHinge.amplitude).toBeCloseTo(atHinge.amplitude, 4);
    expect(afterHinge.rotation).toBeCloseTo(atHinge.rotation, 4);
    expect(afterHinge.landedLength).toBeCloseTo(atHinge.landedLength, 6);
  });

  it('starts commit settling at the final drag pose and ends flat', () => {
    const released = profile(0.45);
    const commitStart = profile(0.45, {
      settling: true,
      settleTo: 1,
      releaseProgress: 0.45,
    });
    const committed = profile(1, {
      settling: true,
      settleTo: 1,
      releaseProgress: 0.45,
    });

    expect(commitStart).toEqual(released);
    expect(committed.amplitude).toBeCloseTo(0, 8);
    expect(committed.rotation).toBeCloseTo(Math.PI, 8);
    expect(committed.landedLength).toBeCloseTo(1, 8);
  });

  it('reverses the sampled drag pose back to a flat source page', () => {
    const released = profile(0.45);
    const revertStart = profile(0.45, {
      settling: true,
      settleTo: 0,
      releaseProgress: 0.45,
    });
    const reverted = profile(0, {
      settling: true,
      settleTo: 0,
      releaseProgress: 0.45,
    });

    expect(revertStart).toEqual(released);
    expect(reverted.amplitude).toBe(0);
    expect(reverted.rotation).toBe(0);
    expect(reverted.landedLength).toBe(0);
  });

  it('restores physical finger travel for single-page forward gestures', () => {
    expect(profile(0.5)).toEqual(profile(0.25, { spreadMode: 'single' }));
  });
});

describe('automatic curl geometry', () => {
  it('holds rotation during the reference press interval', () => {
    const pressEnd = 120 / AUTOMATIC_PAGE_TURN_DURATION_MS;
    const pressed = createAutomaticCurlProfile(pressEnd);
    const turning = createAutomaticCurlProfile(pressEnd + 0.01);

    expect(AUTOMATIC_PAGE_TURN_DURATION_MS).toBe(947);
    expect(pressed.amplitude).toBeCloseTo(bendAmplitudeForChord(0.9), 6);
    expect(pressed.rotation).toBe(0);
    expect(turning.rotation).toBeGreaterThan(0);
  });

  it('finishes as a flat sheet on the destination side', () => {
    const completed = createAutomaticCurlProfile(1);

    expect(completed.amplitude).toBeCloseTo(0, 8);
    expect(completed.rotation).toBeCloseTo(Math.PI, 8);
    expect(completed.landedLength).toBeCloseTo(1, 8);
  });
});
