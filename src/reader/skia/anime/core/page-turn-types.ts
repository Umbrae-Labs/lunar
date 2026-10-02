import type { Matrix4 } from '@shopify/react-native-skia';
import type { DerivedValue, SharedValue } from 'react-native-reanimated';

import type { ReaderRect, ReaderRenderFrame, ReaderSnapshot } from '../../../contracts';
import type { CompiledReaderPicture } from '../../rendering/picture-compiler';

export type ReaderPageAnimationStyle = 'none' | 'page' | 'slide' | 'overlay' | 'pageCurl' | 'simulation';

export const READER_PAGE_ANIMATION_STYLES: readonly ReaderPageAnimationStyle[] = ['none', 'page', 'slide'];

export interface ReaderPageOverlay {
  readonly revisionId?: number;
  readonly bounds: ReaderRect;
  readonly color: string;
  readonly radius?: number;
  readonly outline?: boolean;
  readonly thickness?: number;
  readonly decoration?: 'underline' | 'wavy';
}

export interface ReaderPageContent {
  readonly key: string;
  readonly snapshot: ReaderSnapshot;
  readonly picture: CompiledReaderPicture;
  readonly frame: ReaderRenderFrame;
  readonly overlays?: readonly ReaderPageOverlay[];
  readonly bookmarked?: boolean;
}

export interface ReaderPageTransitionState {
  readonly from: ReaderPageContent;
  readonly toKey: string;
  readonly direction: 1 | -1;
}

export interface ReaderPageTransitionValues {
  readonly transition?: ReaderPageTransitionState;
  readonly visibleContent?: ReaderPageContent;
  readonly visualKind: 'none' | 'curl' | 'slide';
  /** @deprecated Use primaryMatrix for the resolved primary page transform. */
  readonly coverMatrix: DerivedValue<Matrix4>;
  readonly primaryMatrix: DerivedValue<Matrix4>;
  readonly incomingSlideMatrix: DerivedValue<Matrix4>;
  readonly outgoingSlideMatrix: DerivedValue<Matrix4>;
  readonly progress: SharedValue<number> | DerivedValue<number>;
  readonly grabX: number;
  readonly grabY: number;
}

export interface ReaderInteractiveTurn {
  readonly performanceId?: string;
  /** Retain the page visible when this gesture began, across snapshot updates. */
  readonly source?: ReaderPageContent;
  /** The source can start moving while the adjacent picture is being prepared. */
  readonly content?: ReaderPageContent;
  readonly direction: 1 | -1;
  readonly progress: number;
  /** Shared value updated by the gesture without a React render. */
  readonly progressValue?: SharedValue<number>;
  readonly grabX?: number;
  readonly grabY?: number;
  /** Signed release speed in page-widths per second; positive points toward the target. */
  readonly releaseVelocity?: number;
  /** Set while the finger release is being animated to its terminal pose. */
  readonly settling?: boolean;
  readonly settleTo?: 0 | 1;
  /** Runs on the RN runtime after the UI timing animation reaches its target. */
  readonly onSettleComplete?: () => void;
  readonly pressedEdgeX?: number;
  readonly pressedEdgeXValue?: SharedValue<number>;
  readonly heldRollTilt?: number;
  readonly heldRollTiltValue?: SharedValue<number>;
  readonly grabYValue?: SharedValue<number>;
  readonly fingerX?: number;
  readonly startBookX?: number;
  readonly throwVelocity?: number;
  readonly throwAcceleration?: number;
  readonly nativeGesture?: ReaderNativeGestureState;
}

export interface ReaderNativeGestureState {
  readonly token: number;
  readonly preparedTurnId: number;
  readonly driven: boolean;
  readonly settling: boolean;
  readonly consumed: boolean;
}

export interface ReaderAutomaticTurn {
  readonly performanceId?: string;
  readonly id: number;
  readonly from: ReaderPageContent;
  readonly to: ReaderPageContent;
  readonly direction: 1 | -1;
}
