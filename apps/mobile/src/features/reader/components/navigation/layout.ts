import type { EdgeInsets } from 'react-native-safe-area-context';

import { TabBarHeight } from './tab-bar';

export const BarHeight = TabBarHeight;

/** The top toolbar's button row (`h-12`) and bottom padding (`pb-2`), below the safe area. */
export const ToolbarHeight = 56;

export function getBarInset(bottomSafeArea: number): number {
  return bottomSafeArea + BarHeight;
}

/** Space the system bars and, while they show, the reader's toolbar and tab bar cover at each edge. */
export function getReaderChromeInsets(safeArea: EdgeInsets, controlsVisible: boolean): EdgeInsets {
  return {
    top: safeArea.top + (controlsVisible ? ToolbarHeight : 0),
    right: safeArea.right,
    bottom: controlsVisible ? getBarInset(safeArea.bottom) : safeArea.bottom,
    left: safeArea.left,
  };
}
