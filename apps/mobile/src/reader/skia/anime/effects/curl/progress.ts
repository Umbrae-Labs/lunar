import { clampUnit } from '../../core/page-turn-math';

export function singlePreviousCurlProgress(progress: number): number {
  'worklet';
  const revealEnd = 0.18;
  const landingStart = 0.15;
  const safeProgress = clampUnit(progress);
  if (safeProgress <= revealEnd) return landingStart;
  const landingProgress = (safeProgress - revealEnd) / (1 - revealEnd);
  return landingStart + (1 - landingStart) * landingProgress;
}

export function automaticSinglePreviousCurlProgress(progress: number): number {
  'worklet';
  const revealEnd = 0.18;
  const landingStart = 0.15;
  const safeProgress = clampUnit(progress);
  if (safeProgress <= revealEnd) return landingStart;
  const linear = (safeProgress - revealEnd) / (1 - revealEnd);
  const eased = 1 - (1 - linear) ** 3;
  return landingStart + (1 - landingStart) * eased;
}

export function singlePreviousCurlRevealProgress(progress: number): number {
  'worklet';
  return clampUnit(progress / 0.18);
}

export function gestureSinglePreviousCurlShapeProgress(progress: number): number {
  'worklet';
  const revealEnd = 0.1;
  const landingStart = 0.15;
  const safeProgress = clampUnit(progress);
  if (safeProgress <= revealEnd) return landingStart;
  const landingProgress = (safeProgress - revealEnd) / (1 - revealEnd);
  return landingStart + (1 - landingStart) * landingProgress;
}

export function gestureSinglePreviousCurlRevealProgress(progress: number): number {
  'worklet';
  return clampUnit(progress / 0.1);
}

export function gestureSinglePreviousCurlProgress(progress: number): number {
  'worklet';
  return clampUnit(progress / 0.72);
}

export function gestureSinglePreviousCurlRemainingDurationMs(progress: number): number {
  return (700 * (1 - clampUnit(progress))) / 0.9;
}
