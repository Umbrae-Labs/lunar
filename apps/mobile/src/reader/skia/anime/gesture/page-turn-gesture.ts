import { clampUnit } from '../core/page-turn-math';

/** Weight each new pan sample carries in the tracked throw velocity. */
export const GESTURE_THROW_VELOCITY_SMOOTHING = 0.35;

/** Per-frame step that turns a tracked velocity change into an acceleration. */
export const GESTURE_THROW_ACCELERATION_STEP = 60;

export function planarTurnProgressForTranslation(translationX: number, direction: 1 | -1, pageWidth: number): number {
  'worklet';
  const distance = direction === 1 ? -translationX : translationX;
  return clampUnit(distance / Math.max(1, pageWidth));
}

/**
 * Signed speed of a pan sample in page widths per second, normalized so a
 * value always points along the turn the gesture is heading for.
 */
export function directedThrowVelocity(velocityX: number, direction: 1 | -1, pageWidth: number): number {
  'worklet';
  return Math.max(0, (direction === 1 ? -velocityX : velocityX) / Math.max(1, pageWidth));
}

/**
 * Folds a pan sample into the tracked throw velocity. Both the JavaScript
 * release decision and the native pager release read this sample, so they have
 * to agree on it.
 */
export function trackThrowVelocity(
  trackedVelocity: number,
  velocityX: number,
  direction: 1 | -1,
  pageWidth: number,
): number {
  'worklet';
  return (
    trackedVelocity +
    (directedThrowVelocity(velocityX, direction, pageWidth) - trackedVelocity) * GESTURE_THROW_VELOCITY_SMOOTHING
  );
}

/** Tracked velocity change of a release, in page widths per second squared. */
export function throwAccelerationForRelease(
  trackedVelocity: number,
  velocityX: number,
  direction: 1 | -1,
  pageWidth: number,
): number {
  'worklet';
  const instantaneous = directedThrowVelocity(velocityX, direction, pageWidth);
  return Math.max(0, (instantaneous - trackedVelocity) * GESTURE_THROW_ACCELERATION_STEP);
}
