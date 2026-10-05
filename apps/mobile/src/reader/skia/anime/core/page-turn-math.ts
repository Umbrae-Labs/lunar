export const AUTOMATIC_PLANAR_PAGE_TURN_MIN_DURATION_MS = 100;
export const PLANAR_COMMIT_PROGRESS = 0.5;
export const PLANAR_RELEASE_PROJECTION_SECONDS = 0.18;

export function clampPageTurnDuration(value: number): number {
  return Number.isFinite(value) ? Math.min(1200, Math.max(120, Math.round(value))) : 360;
}

export function clampUnit(value: number): number {
  'worklet';
  return Math.min(1, Math.max(0, value));
}

export function projectedPageTurnProgress(
  progress: number,
  towardTargetVelocity: number,
  projectionSeconds: number,
): number {
  'worklet';
  return clampUnit(progress) + towardTargetVelocity * projectionSeconds;
}

export function crossesPageTurnCommitThreshold(
  progress: number,
  towardTargetVelocity: number,
  projectionSeconds = PLANAR_RELEASE_PROJECTION_SECONDS,
): boolean {
  'worklet';
  return projectedPageTurnProgress(progress, towardTargetVelocity, projectionSeconds) > PLANAR_COMMIT_PROGRESS;
}

export function getPlanarPageTurnDuration(releaseVelocity: number, animationDuration: number): number {
  const releaseSpeed = Math.min(6, Math.max(0, releaseVelocity));
  const releaseBoost = Math.min(0.55, releaseSpeed * 0.08);
  return Math.max(140, Math.round(clampPageTurnDuration(animationDuration) * (1 - releaseBoost)));
}

export function getPlanarPageTurnSettleDuration(
  fromProgress: number,
  targetProgress: 0 | 1,
  releaseVelocity: number,
  animationDuration: number,
): number {
  const distance = Math.abs(clampUnit(targetProgress) - clampUnit(fromProgress));
  const minimumDuration = targetProgress === 0 ? 180 : 90;
  const towardTarget = releaseVelocity * (targetProgress - fromProgress) > 0;
  const releaseSpeed = towardTarget ? Math.min(6, Math.abs(releaseVelocity)) : 0;
  const releaseBoost = Math.min(0.5, releaseSpeed * 0.08);
  return Math.max(
    minimumDuration,
    Math.round(clampPageTurnDuration(animationDuration) * distance * (1 - releaseBoost)),
  );
}

export function getPlanarAutomaticPageTurnDuration(
  queuedTurnCount: number,
  fromProgress: number,
  baseDuration: number,
): number {
  const queuedTurns = Math.max(1, Math.floor(queuedTurnCount));
  const turnDuration = Math.max(
    AUTOMATIC_PLANAR_PAGE_TURN_MIN_DURATION_MS,
    Math.round(baseDuration / Math.min(4, queuedTurns)),
  );
  return Math.max(32, Math.round(turnDuration * (1 - clampUnit(fromProgress))));
}
