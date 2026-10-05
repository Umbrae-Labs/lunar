import {
  MIN_PRESSED_EDGE_X,
  gestureLiftRotationForFingerX,
  gesturePressedChordForFingerX,
  postHingeTurnProgressForFingerX,
} from './gesture';
import { AUTOMATIC_PAGE_TURN_DURATION_MS } from './strategy';

export { AUTOMATIC_PAGE_TURN_DURATION_MS } from './strategy';

const CURVATURE_RELAXATION = 10;
// Inverse J0 over chord lengths [0.035, 1]. This is the reference worklet's
// degree-10 Chebyshev approximation, with less than 9e-8 radians of error.
const INVERSE_BESSEL_CHEBYSHEV = [
  2.1667709839070377, -0.18629174453685354, 0.02265270180455248, -0.0037165828681793253, 0.0007038952663799921,
  -0.00014500246546194032, 0.000031566578791633, -0.000007135535298704449, 0.0000016623788064225635,
  -0.0000003841457726910674, 0.00000009309814723863693,
] as const;
const INVERSE_BESSEL_MIN_CHORD = 0.035;
const AUTOMATIC_RELEASE_X = 0.9;
const AUTOMATIC_CURVATURE_RELAXATION = 10;
const AUTOMATIC_REVERSE_RELEASE_X = 0.4;
const AUTOMATIC_PRESS_DURATION_MS = 120;

export interface GestureCurlProfile {
  readonly amplitude: number;
  readonly rotation: number;
  readonly landedLength: number;
  readonly uniformity: number;
}

interface GestureCurlProfileOptions {
  readonly progress: number;
  readonly direction: 1 | -1;
  readonly startBookX: number;
  readonly pressedEdgeX: number;
  readonly heldRollTilt: number;
  readonly spreadMode: 'single' | 'double';
  readonly settling: boolean;
  readonly settleTo: 0 | 1;
  readonly releaseProgress: number;
}

// Keep local worklet dependencies above the worklet that captures them. The
// native Worklets compiler serializes module-local helpers in source order.
function clampUnit(value: number): number {
  'worklet';
  return Math.min(1, Math.max(0, value));
}

export function bendAmplitudeForChord(chord: number): number {
  'worklet';
  if (chord >= 0.999999) return 0;
  const safeChord = Math.min(0.999999, Math.max(MIN_PRESSED_EDGE_X, chord));
  const x = (2 * (safeChord - INVERSE_BESSEL_MIN_CHORD)) / (1 - INVERSE_BESSEL_MIN_CHORD) - 1;
  let beforePrevious = 0;
  let previous = 0;
  for (let index = INVERSE_BESSEL_CHEBYSHEV.length - 1; index >= 1; index -= 1) {
    const current = 2 * x * previous - beforePrevious + INVERSE_BESSEL_CHEBYSHEV[index]!;
    beforePrevious = previous;
    previous = current;
  }
  const normalized = x * previous - beforePrevious + INVERSE_BESSEL_CHEBYSHEV[0]!;
  return normalized * Math.sqrt(Math.max(0, 1 - safeChord));
}

function createTurnCurlProfile(
  progress: number,
  startAmplitude: number,
  startRotation: number,
  curvatureRelaxation: number,
): GestureCurlProfile {
  'worklet';
  const rootTangent = startRotation + startAmplitude;
  const swing = Math.min(1, Math.max(0, (Math.PI - rootTangent) / Math.PI));
  const landingStart = swing / (swing + 1);
  const landing = progress > landingStart;
  const landedLength = landing ? (progress - landingStart) / Math.max(0.000001, 1 - landingStart) : 0;
  const retained = (1 - landedLength) ** (1 + curvatureRelaxation / 14);
  const amplitude = startAmplitude * retained;
  return {
    amplitude,
    rotation: landing
      ? Math.PI - amplitude
      : startRotation + (Math.PI - rootTangent) * (progress / Math.max(0.000001, landingStart)),
    landedLength,
    uniformity: 1 - retained ** 3,
  };
}

export function createAutomaticCurlProfile(progress: number): GestureCurlProfile {
  'worklet';
  const animationProgress = clampUnit(progress);
  const pressFraction = AUTOMATIC_PRESS_DURATION_MS / AUTOMATIC_PAGE_TURN_DURATION_MS;
  if (animationProgress <= pressFraction) {
    const pressProgress = animationProgress / Math.max(0.000001, pressFraction);
    const edgeX = 1 + (AUTOMATIC_RELEASE_X - 1) * pressProgress;
    return {
      amplitude: bendAmplitudeForChord(edgeX),
      rotation: 0,
      landedLength: 0,
      uniformity: 0,
    };
  }
  const turnProgress = (animationProgress - pressFraction) / (1 - pressFraction);
  return createTurnCurlProfile(
    turnProgress,
    bendAmplitudeForChord(AUTOMATIC_RELEASE_X),
    0,
    AUTOMATIC_CURVATURE_RELAXATION,
  );
}

export function createIncomingCurlProfile(
  progress: number,
  releaseX = AUTOMATIC_REVERSE_RELEASE_X,
): GestureCurlProfile {
  'worklet';
  return createTurnCurlProfile(clampUnit(progress), bendAmplitudeForChord(releaseX), 0, AUTOMATIC_CURVATURE_RELAXATION);
}

export function createGestureCurlProfile({
  progress,
  direction,
  startBookX,
  pressedEdgeX,
  heldRollTilt,
  spreadMode,
  settling,
  settleTo,
  releaseProgress,
}: GestureCurlProfileOptions): GestureCurlProfile {
  'worklet';
  const animationProgress = clampUnit(progress);
  const safeReleaseProgress = clampUnit(releaseProgress);
  const progressScale = spreadMode === 'single' && direction > 0 ? 2 : 1;
  const currentFingerX = 1 - Math.min(1, animationProgress * progressScale);
  const releaseFingerX = 1 - Math.min(1, safeReleaseProgress * progressScale);
  let profileProgress = postHingeTurnProgressForFingerX(currentFingerX, startBookX);
  let profilePressedEdgeX = Math.min(1, Math.max(MIN_PRESSED_EDGE_X, pressedEdgeX));
  let profileHeldRollTilt = Math.max(0, heldRollTilt);

  if (settling && settleTo === 1) {
    const releasedProfileProgress = postHingeTurnProgressForFingerX(releaseFingerX, startBookX);
    const settleProgress = (animationProgress - safeReleaseProgress) / Math.max(0.000001, 1 - safeReleaseProgress);
    profileProgress = releasedProfileProgress + (1 - releasedProfileProgress) * clampUnit(settleProgress);
  } else if (settling) {
    profileHeldRollTilt = gestureLiftRotationForFingerX(currentFingerX);
    profilePressedEdgeX = gesturePressedChordForFingerX(currentFingerX, profileHeldRollTilt);
  }

  const startAmplitude = bendAmplitudeForChord(profilePressedEdgeX);
  if (profileProgress <= 0) {
    return {
      amplitude: startAmplitude,
      rotation: profileHeldRollTilt,
      landedLength: 0,
      uniformity: 0,
    };
  }

  return createTurnCurlProfile(profileProgress, startAmplitude, profileHeldRollTilt, CURVATURE_RELAXATION);
}
