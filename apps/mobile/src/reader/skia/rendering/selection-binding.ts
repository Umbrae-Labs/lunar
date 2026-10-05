import type { SharedValue } from 'react-native-reanimated';
import type { ReaderRect } from '../../contracts';
import type { ReaderSelectionPoint } from '../../interaction/selection-geometry';

/** UI-owned selection visuals, independent of React's committed text selection. */
export interface ReaderSelectionBinding {
  readonly rects: SharedValue<readonly ReaderRect[]>;
  readonly startHandle: SharedValue<ReaderSelectionPoint>;
  readonly endHandle: SharedValue<ReaderSelectionPoint>;
  readonly dragging: SharedValue<boolean>;
  readonly visible: SharedValue<boolean>;
}
