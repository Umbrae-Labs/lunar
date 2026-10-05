import type { ReaderSpreadMode } from '../../../contracts';

import type { ReaderPageAnimationStyle } from './page-turn-types';

export type ResolvedReaderPageAnimationStyle = 'none' | 'page' | 'slide';
export type ReaderPageTurnVisualKind = 'none' | 'curl' | 'slide';
export type ReaderNativePageTurnVisualKind = 'curl' | 'slide';
export type ReaderPageTurnEasing = (progress: number) => number;
export type ReaderPageTurnTransform = ({ readonly translateX: number } | { readonly scaleX: number })[];

export interface ReaderPageTurnVisualContext {
  readonly direction: 1 | -1;
  readonly width: number;
  readonly progress: number;
}

export interface ReaderPageTurnGestureProgressContext {
  readonly physicalProgress: number;
  readonly direction: 1 | -1;
  readonly spreadMode: ReaderSpreadMode;
}

export interface ReaderPageTurnGestureGeometryContext {
  readonly startBookX: number;
  readonly translationX: number;
  readonly direction: 1 | -1;
  readonly pageWidth: number;
}

export interface ReaderPageTurnGestureGeometry {
  readonly fingerX: number;
  readonly heldRollTilt: number;
  readonly pressedEdgeX: number;
}

export interface ReaderPageTurnReleaseContext {
  readonly progress: number;
  /** Signed speed in page widths per second; positive points toward the target. */
  readonly towardTargetVelocity: number;
  readonly direction: 1 | -1;
  readonly spreadMode: ReaderSpreadMode;
  readonly startBookX: number;
  readonly fingerX: number;
  readonly throwVelocity: number;
  readonly throwAcceleration: number;
}

export interface ReaderPageTurnDurationContext {
  readonly releaseVelocity: number;
  readonly animationDuration: number;
  readonly incomingPageLanding: boolean;
}

export interface ReaderPageTurnSettleContext {
  readonly fromProgress: number;
  readonly targetProgress: 0 | 1;
  readonly releaseVelocity: number;
  readonly throwVelocity: number;
  readonly animationDuration: number;
  readonly pageWidth: number;
  readonly direction: 1 | -1;
  readonly spreadMode: ReaderSpreadMode;
  readonly fingerX: number;
  readonly pressedEdgeX: number;
  readonly heldRollTilt: number;
  readonly startBookX: number;
}

export interface ReaderAutomaticPageTurnDurationContext {
  readonly queuedTurnCount: number;
  readonly fromProgress: number;
  readonly animationDuration: number;
  readonly incomingPageLanding: boolean;
}

export interface ReaderPageTurnEasingContext {
  readonly fromProgress: number;
  readonly targetProgress: 0 | 1;
  readonly releaseVelocityPxPerMs: number;
  readonly incomingPageLanding: boolean;
  readonly interactive: boolean;
}

export interface ReaderNativePageTurnGesturePolicy {
  readonly minimumStartBookX: number;
  canStart(direction: 1 | -1, startBookX: number): boolean;
  getReleaseTuning(direction: 1 | -1, spreadMode: ReaderSpreadMode): ReaderNativePageTurnGestureReleaseTuning;
}

export interface ReaderNativePageTurnGestureReleaseTuning {
  readonly pageWeight: number;
  readonly commitThreshold: number;
  readonly slowCommitEdgeX: number;
  readonly minimumSpeedScale: number;
  readonly maximumSpeedScale: number;
  readonly velocityGain: number;
  readonly idleDecaySeconds: number;
  readonly releaseProjectionSeconds: number;
}

export interface ReaderNativePlanarPageTurnMotionTuning {
  readonly minimumReleaseSpeedPxPerMs: number;
  readonly maximumReleaseSpeedPxPerMs: number;
  readonly maximumPlaybackRate: number;
  readonly minimumBoostedSettleMs: number;
  readonly maximumEaseOutBlend: number;
}

export interface ReaderNativePageTurnMotionTuning {
  readonly releaseX: number;
  readonly liftVelocity: number;
  readonly liftToLeft: number;
  readonly curvatureRelaxation: number;
  readonly incomingLandingStartProgress?: number;
  readonly incomingRevealStartProgress?: number;
  readonly incomingRevealEndProgress?: number;
  readonly incomingDragProgressScale?: number;
  readonly incomingDragProgressExponent?: number;
  readonly incomingSettleDurationSeconds?: number;
  readonly incomingSettleEasingPower?: number;
  readonly incomingRevertDurationSeconds?: number;
}

export interface ReaderNativePageTurnMotionConfig {
  readonly automatic: ReaderNativePageTurnDirectionalMotionTuning;
  readonly rapid: ReaderNativePageTurnDirectionalMotionTuning;
  readonly gesture: ReaderNativePageTurnDirectionalMotionTuning;
}

export interface ReaderNativePageTurnDirectionalMotionTuning {
  readonly forward: ReaderNativePageTurnMotionTuning;
  readonly backward: ReaderNativePageTurnMotionTuning;
}

export interface ReaderPageTurnEffect {
  readonly style: ResolvedReaderPageAnimationStyle;
  readonly visual: {
    readonly kind: ReaderPageTurnVisualKind;
    isIncomingPageLanding(direction: 1 | -1, spreadMode: ReaderSpreadMode): boolean;
    getPrimaryTransform(context: ReaderPageTurnVisualContext): ReaderPageTurnTransform;
    getIncomingTransform(context: ReaderPageTurnVisualContext): ReaderPageTurnTransform;
    getOutgoingTransform(context: ReaderPageTurnVisualContext): ReaderPageTurnTransform;
  };
  readonly gesture: {
    getStartBookX(localX: number, direction: 1 | -1, pageWidth: number): number;
    getGeometry(context: ReaderPageTurnGestureGeometryContext): ReaderPageTurnGestureGeometry;
    renderProgress(context: ReaderPageTurnGestureProgressContext): number;
    shouldCommit(context: ReaderPageTurnReleaseContext): boolean;
  };
  readonly motion: {
    getDuration(context: ReaderPageTurnDurationContext): number;
    getSettleDuration(context: ReaderPageTurnSettleContext): number;
    getAutomaticDuration(context: ReaderAutomaticPageTurnDurationContext): number;
    getEasing(context: ReaderPageTurnEasingContext): ReaderPageTurnEasing;
  };
  readonly orchestration: {
    readonly serializesAutomaticTurns: boolean;
    readonly usesAutomaticTransition: boolean;
    readonly usesPlanarAutomaticTransition: boolean;
  };
  readonly native?: {
    /** Single-page body and decorations move independently of fixed chrome. */
    readonly separateChrome?: boolean;
    readonly visualKind: ReaderNativePageTurnVisualKind;
    readonly gesture: ReaderNativePageTurnGesturePolicy;
    readonly motion: ReaderNativePageTurnMotionConfig;
    readonly planarMotion?: ReaderNativePlanarPageTurnMotionTuning;
  };
}

export type ReaderPageTurnEffectResolver = (style: ReaderPageAnimationStyle) => ReaderPageTurnEffect;
