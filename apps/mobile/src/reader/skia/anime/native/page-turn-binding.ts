import type { SharedValue } from 'react-native-reanimated';

import type { NativePagerEventRecord } from './pager-compositor';

export interface ReaderPageTurnSurfaceBinding {
  readonly nativeId: SharedValue<number>;
  readonly inputReady: SharedValue<boolean>;
  readonly stockedGestureToken: SharedValue<number>;
  readonly onNativeEvent: (event: NativePagerEventRecord) => void;
}
