import type { SkPicture } from '@shopify/react-native-skia';

import type {
  ReaderNativePageTurnDirectionalMotionTuning,
  ReaderNativePageTurnMotionConfig,
  ReaderNativePageTurnMotionTuning,
  ReaderNativePageTurnVisualKind,
  ReaderNativePlanarPageTurnMotionTuning,
} from '../core/page-turn-effect';

export type NativePagerEvent =
  'consumed' | 'gesture-started' | 'gesture-released' | 'completed' | 'cancelled' | 'stock-miss';

export interface NativePagerEventRecord {
  readonly id: string;
  readonly event: NativePagerEvent;
  readonly eventAtMs: number;
  readonly direction?: 1 | -1;
}

export interface NativePagerCanvasHandle {
  getNativeId(): number;
}

export type NativePagerMotionTuning = ReaderNativePageTurnMotionTuning;
export type NativePagerMotionConfig = ReaderNativePageTurnMotionConfig;
export type NativePagerDirectionalMotionTuning = ReaderNativePageTurnDirectionalMotionTuning;
export type NativePagerVisualKind = ReaderNativePageTurnVisualKind;
export type NativePagerPlanarMotionTuning = ReaderNativePlanarPageTurnMotionTuning;

/**
 * One page as the composer receives it. `textureKey` names the painted look,
 * decorations included; `pageKey` is the navigation identity. `picture` covers
 * the viewport at `pixelWidth` x `pixelHeight`, both pages of a spread side by
 * side.
 */
export interface NativePagerPage {
  readonly pageKey: string;
  readonly textureKey: string;
  readonly picture: SkPicture;
  /** Fixed chrome above a sliding body; omitted when it is recorded into `picture`. */
  readonly chromePicture?: SkPicture;
  /** The page without its bookmark ribbon, shown while a bookmark pull moves it. */
  readonly pullPicture?: SkPicture;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly spread: boolean;
  readonly paperColor: number;
}

export interface NativePagerPresentCommand {
  readonly page: NativePagerPage;
  /** Turn from the shown page to this one: 1 forward, -1 backward, 0 for none. */
  readonly transition: 1 | -1 | 0;
  readonly durationMs: number;
  readonly launchIntervalMs: number;
  /** The runtime could not follow the composer: show this page whatever it leads to. */
  readonly force: boolean;
}

export interface NativePagerStockCommand {
  readonly id: string;
  readonly source: NativePagerPage;
  readonly target: NativePagerPage;
  readonly direction: 1 | -1;
  readonly durationMs: number;
  readonly rapidDurationMs: number;
  readonly launchIntervalMs: number;
}

export interface NativePagerGestureRelease {
  readonly fingerX: number;
  readonly pageWidth: number;
  readonly throwVelocity: number;
  readonly throwAcceleration: number;
  readonly pageWeight: number;
  readonly commitThreshold: number;
  readonly slowCommitEdgeX: number;
  readonly minimumSpeedScale: number;
  readonly maximumSpeedScale: number;
  readonly velocityGain: number;
  readonly idleDecaySeconds: number;
  readonly releaseProjectionSeconds: number;
}

export interface NativePagerGestureStart {
  readonly direction: 1 | -1;
  readonly startBookX: number;
  readonly fingerX: number;
  readonly turnProgress: number;
}

export interface NativePagerGestureUpdate {
  readonly fingerX: number;
  readonly turnProgress: number;
}

export * from './pager-compositor.native';
