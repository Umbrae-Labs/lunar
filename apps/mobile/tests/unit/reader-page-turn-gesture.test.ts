import { describe, expect, it } from 'vitest';

import {
  PLANAR_RELEASE_PROJECTION_SECONDS,
  projectedPageTurnProgress,
} from '../../src/reader/skia/anime/core/page-turn-math';
import {
  GESTURE_HINGE_CHORD_X,
  GESTURE_LIFT_START_FINGER_X,
  MIN_PRESSED_EDGE_X,
} from '../../src/reader/skia/anime/effects/curl/gesture';
import { curlPageTurnEffect } from '../../src/reader/skia/anime/effects/curl/strategy';
import {
  SLIDE_RELEASE_PROJECTION_SECONDS,
  slidePageTurnEffect,
} from '../../src/reader/skia/anime/effects/slide/strategy';
import {
  pageTurnLeaf,
  planarTurnProgressForTranslation,
  releaseIdleDecay,
  trackThrowAcceleration,
  trackThrowVelocity,
} from '../../src/reader/skia/anime/gesture/page-turn-gesture';

describe('reader page turn gesture effects', () => {
  it('uses Persimmon pressed-roll geometry', () => {
    expect(MIN_PRESSED_EDGE_X).toBe(0.14);
    expect(GESTURE_LIFT_START_FINGER_X).toBe(0.36);
    expect(GESTURE_HINGE_CHORD_X).toBeCloseTo(0.1514800382);
  });
  it('tracks directed physical finger travel across the page', () => {
    expect(planarTurnProgressForTranslation(-70, 1, 100)).toBe(0.7);
    expect(planarTurnProgressForTranslation(20, -1, 100)).toBe(0.2);
    expect(planarTurnProgressForTranslation(20, 1, 100)).toBe(0);
  });

  it('keeps half-speed single-page travel inside the curl effect', () => {
    expect(curlPageTurnEffect.gesture.renderProgress({
      physicalProgress: 0.5,
      direction: 1,
      spreadMode: 'single',
    })).toBe(0.25);
    expect(curlPageTurnEffect.gesture.renderProgress({
      physicalProgress: 1,
      direction: 1,
      spreadMode: 'single',
    })).toBe(0.5);
    expect(slidePageTurnEffect.gesture.renderProgress({
      physicalProgress: 0.5,
      direction: 1,
      spreadMode: 'single',
    })).toBe(0.5);
    expect(curlPageTurnEffect.gesture.renderProgress({
      physicalProgress: 0.5,
      direction: 1,
      spreadMode: 'double',
    })).toBe(0.5);
  });

  it('keeps the incoming curl landing calculation in the curl package', () => {
    expect(curlPageTurnEffect.gesture.renderProgress({
      physicalProgress: 0.5,
      direction: -1,
      spreadMode: 'single',
    })).toBeCloseTo(0.5 / 0.72);
    expect(curlPageTurnEffect.gesture.renderProgress({
      physicalProgress: 0.72,
      direction: -1,
      spreadMode: 'single',
    })).toBe(1);
  });

  it('lets each effect own its commit prediction', () => {
    expect(slidePageTurnEffect.gesture.shouldCommit({
      progress: 0.7,
      towardTargetVelocity: 0,
      direction: 1,
      spreadMode: 'single',
      startBookX: 1,
      fingerX: 0.3,
      throwVelocity: 0,
      throwAcceleration: 0,
    })).toBe(true);
    expect(slidePageTurnEffect.gesture.shouldCommit({
      progress: 0.49,
      towardTargetVelocity: 0,
      direction: 1,
      spreadMode: 'single',
      startBookX: 1,
      fingerX: 0.3,
      throwVelocity: 0,
      throwAcceleration: 0,
    })).toBe(false);
    expect(slidePageTurnEffect.gesture.shouldCommit({
      progress: 0.4,
      towardTargetVelocity: 1,
      direction: 1,
      spreadMode: 'single',
      startBookX: 1,
      fingerX: 0.3,
      throwVelocity: 1,
      throwAcceleration: 0,
    })).toBe(true);
    expect(curlPageTurnEffect.gesture.shouldCommit({
      progress: 0.4,
      towardTargetVelocity: 1,
      direction: 1,
      spreadMode: 'single',
      startBookX: 1,
      fingerX: 0,
      throwVelocity: 1,
      throwAcceleration: 0,
    })).toBe(true);
  });

  it('asks a single page for the same commit travel in both directions', () => {
    // A slow forward drag carries the sheet 0.49 screen widths before the
    // commit — the travel a spread already asked of one physical page — while
    // the incoming reveal asks for 0.36 instead of a 0.11 sliver.
    const slowForward = (fingerX: number) => curlPageTurnEffect.gesture.shouldCommit({
      progress: (1 - fingerX) / 2,
      towardTargetVelocity: 0,
      direction: 1,
      spreadMode: 'single',
      startBookX: 1,
      fingerX,
      throwVelocity: 0,
      throwAcceleration: 0,
    });
    const slowReveal = (revealedTravel: number) => curlPageTurnEffect.gesture.shouldCommit({
      progress: revealedTravel / 0.72,
      towardTargetVelocity: 0,
      direction: -1,
      spreadMode: 'single',
      startBookX: 0.2,
      fingerX: 1 - revealedTravel,
      throwVelocity: 0,
      throwAcceleration: 0,
    });

    expect(slowForward(0.567)).toBe(false);
    expect(slowForward(0.5)).toBe(true);
    expect(slowReveal(0.11)).toBe(false);
    expect(slowReveal(0.36)).toBe(true);
  });

  it('keeps the Persimmon commit travel for a spread', () => {
    const slowForward = (fingerX: number) => curlPageTurnEffect.gesture.shouldCommit({
      progress: 0.5,
      towardTargetVelocity: 0,
      direction: 1,
      spreadMode: 'double',
      startBookX: 1,
      fingerX,
      throwVelocity: 0,
      throwAcceleration: 0,
    });

    expect(slowForward(0.14)).toBe(false);
    expect(slowForward(0.02)).toBe(true);
  });

  it('keeps each release projection duration independently testable', () => {
    expect(projectedPageTurnProgress(
      0.4,
      1,
      PLANAR_RELEASE_PROJECTION_SECONDS,
    )).toBeCloseTo(0.58);
    expect(projectedPageTurnProgress(
      0.4,
      -1,
      PLANAR_RELEASE_PROJECTION_SECONDS,
    )).toBeCloseTo(0.22);
    expect(projectedPageTurnProgress(
      0.4,
      1,
      SLIDE_RELEASE_PROJECTION_SECONDS,
    )).toBeCloseTo(0.64);
  });

  it('only presses the page when a drag starts near the spine', () => {
    const weak = curlPageTurnEffect.gesture.getGeometry({ startBookX: 0.2, translationX: -150, direction: 1, pageWidth: 300 });
    expect(weak.heldRollTilt).toBe(0);
    expect(weak.pressedEdgeX).toBeCloseTo(0.96);
    const full = curlPageTurnEffect.gesture.getGeometry({ startBookX: 0.8, translationX: -150, direction: 1, pageWidth: 300 });
    expect(full.pressedEdgeX).toBeLessThan(0.6);
    expect(curlPageTurnEffect.native?.gesture.canStart(1, 0.2)).toBe(false);
  });

  it('turns one half page about the spine when a spread curls', () => {
    expect(pageTurnLeaf('curl', 'double', 800, 1)).toEqual({ width: 400, offset: 400 });
    expect(pageTurnLeaf('curl', 'double', 800, -1)).toEqual({ width: 400, offset: 0 });
    expect(pageTurnLeaf('curl', 'single', 800, 1)).toEqual({ width: 800, offset: 0 });
    expect(pageTurnLeaf('slide', 'double', 800, 1)).toEqual({ width: 800, offset: 0 });
    // A forward drag from the right page's outer edge grips the leaf fully;
    // a backward drag from the left page's outer edge does too.
    expect(curlPageTurnEffect.gesture.getStartBookX(780 - 400, 1, 400)).toBeCloseTo(0.95);
    expect(curlPageTurnEffect.gesture.getStartBookX(20 - 0, -1, 400)).toBeCloseTo(0.95);
  });

  it('tracks the throw by elapsed time, not by sample count', () => {
    const track = (sampleSeconds: number) => {
      let velocity = 0;
      let acceleration = 0;
      for (let elapsed = 0; elapsed < 0.1 - 1e-9; elapsed += sampleSeconds) {
        const previous = velocity;
        velocity = trackThrowVelocity(velocity, -800, 1, 400, sampleSeconds);
        acceleration = trackThrowAcceleration(acceleration, previous, velocity, sampleSeconds);
      }
      return { velocity, acceleration };
    };
    const at60Hz = track(1 / 60);
    const at120Hz = track(1 / 120);
    expect(at120Hz.velocity).toBeCloseTo(at60Hz.velocity, 6);
    // 2 page widths per second approached with a 45 ms time constant.
    expect(at60Hz.velocity).toBeCloseTo(2 * (1 - Math.exp(-0.1 / 0.045)), 2);
    expect(at120Hz.acceleration).toBeCloseTo(at60Hz.acceleration, 0);
  });

  it('drops the throw of a finger that rested before lifting', () => {
    expect(releaseIdleDecay(0)).toBe(1);
    expect(releaseIdleDecay(0.1)).toBeCloseTo(Math.exp(-1));
    expect(releaseIdleDecay(0.5)).toBeLessThan(0.01);
  });
});
