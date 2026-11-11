import type { ReaderSnapshot } from '../../../contracts';
import type { ReaderPreparedTurn } from '../../../runtime/core/native-reader-runtime';
import type { ReaderPageContent } from '../core/page-turn-types';

export interface ReaderDragState {
  readonly performanceId?: string;
  readonly id: number;
  readonly revisionId: number;
  readonly startSpread: number;
  readonly startX: number;
  readonly source: ReaderPageContent;
  /** Stock token of the pair the drag owns; 0 until it owns one. */
  nativeGestureToken: number;
  /** The composer drives this drag, possibly before its runtime turn is prepared. */
  nativeAccepted?: boolean;
  direction: 1 | -1;
  directionLocked: boolean;
  pendingPublished: boolean;
  startBookX: number;
  physicalProgress: number;
  renderProgress: number;
  grabX: number;
  grabY: number;
  fingerX: number;
  pressedEdgeX: number;
  heldRollTilt: number;
  throwVelocity: number;
  throwAcceleration: number;
  preparing: boolean;
  prepared: boolean;
  preparation?: Promise<ReaderPreparedTurn | undefined>;
  preparedTurn?: ReaderPreparedTurn;
  target?: ReaderPageContent;
  targetUnavailableLogged?: boolean;
}

export interface ReaderCommittedHandoff {
  readonly performanceId?: string;
  readonly turnId: number;
  readonly generation: number;
  readonly revisionId: number;
  readonly spreadIndex: number;
  readonly renderId: number;
  readonly nativeTurnId?: string;
  waitingForFrames?: boolean;
}

/** What a committed native sheet resolved to: the turn it committed, if one was prepared. */
export interface ReaderNativeCommit {
  readonly snapshot: ReaderSnapshot;
  readonly preparedTurn?: ReaderPreparedTurn;
}

export interface ReaderNativeGestureHandoff {
  readonly turnId: number;
  readonly gestureToken: number;
  readonly direction: 1 | -1;
  /**
   * Resolves to the runtime turn this sheet commits or cancels. A pair
   * stocked at idle lets the composer move before the drag's turn is
   * prepared, so terminal events wait on it.
   */
  readonly preparation: Promise<ReaderPreparedTurn | undefined>;
  /** Set once the preparation is known, to match events naming a prepared turn. */
  preparedTurn?: ReaderPreparedTurn;
  readonly generation: number;
  commit?: Promise<ReaderNativeCommit>;
  terminalEventHandled: boolean;
}
