import type { PanGesture } from 'react-native-gesture-handler';

export const BOOK_SELECTION_LONG_PRESS_DURATION = 650;
const PRE_LONG_PRESS_SCROLL_TOLERANCE = 8;

export function configureBookSelectionGesture(gesture: PanGesture): PanGesture {
  return (
    gesture
      // Android evaluates distance activation independently of the hold timer.
      // Even diagonal movement must reach a failure boundary before activation.
      .minDistance(PRE_LONG_PRESS_SCROLL_TOLERANCE * 2)
      .activateAfterLongPress(BOOK_SELECTION_LONG_PRESS_DURATION)
      .failOffsetX([-PRE_LONG_PRESS_SCROLL_TOLERANCE, PRE_LONG_PRESS_SCROLL_TOLERANCE])
      .failOffsetY([-PRE_LONG_PRESS_SCROLL_TOLERANCE, PRE_LONG_PRESS_SCROLL_TOLERANCE])
      .maxPointers(1)
  );
}
