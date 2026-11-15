import { clampUnit } from '../core/page-turn-math';

/**
 * Time constants of the tracked throw. Pan events arrive at the display rate,
 * so smoothing per sample would make a 120 Hz drag settle twice as fast as a
 * 60 Hz one; blending by elapsed time keeps the release identical on both.
 */
export const GESTURE_THROW_VELOCITY_TIME_CONSTANT_SECONDS = 0.045;
export const GESTURE_THROW_ACCELERATION_TIME_CONSTANT_SECONDS = 0.06;

/** A finger held still before lifting loses its throw with this time constant. */
export const GESTURE_RELEASE_IDLE_DECAY_SECONDS = 0.1;

const MAX_TRACKED_THROW_VELOCITY = 6;
const MAX_TRACKED_THROW_ACCELERATION = 20;
const MIN_SAMPLE_INTERVAL_SECONDS = 0.001;

/** Wall clock of pan samples, read on the UI runtime inside gesture callbacks. */
export function gestureSampleClockMs(): number {
  'worklet';
  return Date.now();
}

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

/** Folds a pan sample taken `deltaSeconds` after the previous one into the tracked throw velocity. */
export function trackThrowVelocity(
  trackedVelocity: number,
  velocityX: number,
  direction: 1 | -1,
  pageWidth: number,
  deltaSeconds: number,
): number {
  'worklet';
  const instantaneous = Math.min(MAX_TRACKED_THROW_VELOCITY, directedThrowVelocity(velocityX, direction, pageWidth));
  const blend =
    1 - Math.exp(-Math.max(MIN_SAMPLE_INTERVAL_SECONDS, deltaSeconds) / GESTURE_THROW_VELOCITY_TIME_CONSTANT_SECONDS);
  return trackedVelocity + (instantaneous - trackedVelocity) * blend;
}

/** Tracks the rate of change of the tracked throw velocity, in page widths per second squared. */
export function trackThrowAcceleration(
  trackedAcceleration: number,
  previousVelocity: number,
  nextVelocity: number,
  deltaSeconds: number,
): number {
  'worklet';
  const interval = Math.max(MIN_SAMPLE_INTERVAL_SECONDS, deltaSeconds);
  const instantaneous = Math.min(
    MAX_TRACKED_THROW_ACCELERATION,
    Math.max(-MAX_TRACKED_THROW_ACCELERATION, (nextVelocity - previousVelocity) / interval),
  );
  const blend = 1 - Math.exp(-interval / GESTURE_THROW_ACCELERATION_TIME_CONSTANT_SECONDS);
  return trackedAcceleration + (instantaneous - trackedAcceleration) * blend;
}

/** Share of the throw that survives the finger resting `idleSeconds` before it lifts. */
export function releaseIdleDecay(idleSeconds: number, decaySeconds = GESTURE_RELEASE_IDLE_DECAY_SECONDS): number {
  'worklet';
  return Math.exp(-Math.max(0, idleSeconds) / Math.max(0.005, decaySeconds));
}

/**
 * The single release sample. The pan gesture computes it once on the UI
 * runtime and hands the same values to the native pager and to the JavaScript
 * release, so whichever of the two owns the drag reaches the same decision.
 */
export interface PageTurnReleaseSample {
  /** Final pan speed toward the target, after idle decay; never negative. */
  readonly throwVelocity: number;
  /** Tracked throw acceleration after idle decay. */
  readonly throwAcceleration: number;
  /** Idle decay already applied to both values above. */
  readonly idleDecay: number;
}

/** The sheet a drag turns, in viewport coordinates. */
export interface PageTurnLeaf {
  readonly width: number;
  /** Where the sheet starts: a forward spread curl turns the page right of the spine. */
  readonly offset: number;
}

/**
 * A curling spread turns one half page about the spine; every other turn
 * moves the whole viewport. Gesture coordinates are normalized to the sheet.
 */
export function pageTurnLeaf(
  visualKind: 'none' | 'curl' | 'slide',
  spreadMode: 'single' | 'double',
  viewportWidth: number,
  direction: 1 | -1,
): PageTurnLeaf {
  'worklet';
  if (visualKind !== 'curl' || spreadMode === 'single') return { width: viewportWidth, offset: 0 };
  const width = viewportWidth / 2;
  return { width, offset: direction > 0 ? width : 0 };
}
