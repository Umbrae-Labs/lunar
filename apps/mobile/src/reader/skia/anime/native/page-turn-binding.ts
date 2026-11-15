import type { ReaderPageTurnStore } from '../controller/page-turn-store';
import type { PageTurnGestureValues } from '../gesture/use-page-turn-pan-gesture';
import type { NativePagerEventRecord } from './pager-compositor';

/** What the reader surface needs from a page-turn controller. */
export interface ReaderPageTurnSurfaceBinding {
  readonly store: ReaderPageTurnStore;
  readonly values: PageTurnGestureValues;
  readonly onNativeEvent: (event: NativePagerEventRecord) => void;
  /** The composer accepted the pair stocked under this token. */
  readonly onStocked: (token: number) => void;
  /** The composer was reset and holds no stocked pair. */
  readonly onStockLost: () => void;
  /**
   * How the page with this key is reached when the surface presents it: a
   * turn forward (1) or backward (-1) announced by RN navigation, or 0 for a
   * page that simply appears. Each announcement is taken once.
   */
  readonly takeTurnIntent: (pageKey: string) => 1 | -1 | 0;
}
