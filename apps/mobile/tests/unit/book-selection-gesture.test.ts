import type { PanGesture } from 'react-native-gesture-handler';
import { describe, expect, it, vi } from 'vitest';

import {
  BOOK_SELECTION_LONG_PRESS_DURATION,
  configureBookSelectionGesture,
} from '../../src/features/library/components/book-selection-gesture';

describe('bookshelf scroll and hold arbitration', () => {
  it('requires a hold before every sliding selection gesture', () => {
    const gesture = {
      minDistance: vi.fn().mockReturnThis(),
      activateAfterLongPress: vi.fn().mockReturnThis(),
      failOffsetX: vi.fn().mockReturnThis(),
      failOffsetY: vi.fn().mockReturnThis(),
      maxPointers: vi.fn().mockReturnThis(),
    };
    configureBookSelectionGesture(gesture as unknown as PanGesture);

    expect(gesture.activateAfterLongPress).toHaveBeenCalledWith(
      BOOK_SELECTION_LONG_PRESS_DURATION,
    );
    expect(gesture.failOffsetX).toHaveBeenCalled();
    expect(gesture.failOffsetY).toHaveBeenCalled();
  });

  it('makes distance activation unreachable throughout the allowed hold area', () => {
    const gesture = {
      minDistance: vi.fn().mockReturnThis(),
      activateAfterLongPress: vi.fn().mockReturnThis(),
      failOffsetX: vi.fn().mockReturnThis(),
      failOffsetY: vi.fn().mockReturnThis(),
      maxPointers: vi.fn().mockReturnThis(),
    };
    configureBookSelectionGesture(gesture as unknown as PanGesture);

    const distance = gesture.minDistance.mock.calls[0][0] as number;
    const xBounds = gesture.failOffsetX.mock.calls[0][0] as [number, number];
    const yBounds = gesture.failOffsetY.mock.calls[0][0] as [number, number];

    // The four corners have the largest distance from the touch origin.
    // This catches the former zero-distance activation and diagonal bypasses.
    for (const x of xBounds) {
      for (const y of yBounds) {
        expect(Math.hypot(x, y)).toBeLessThan(distance);
      }
    }
    // A hold timer remains available when movement cannot activate the pan.
    expect(gesture.activateAfterLongPress.mock.calls[0][0]).toBeGreaterThan(0);
  });
});
