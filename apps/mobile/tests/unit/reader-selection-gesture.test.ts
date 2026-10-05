import type { PanGesture } from 'react-native-gesture-handler';
import { describe, expect, it, vi } from 'vitest';

import { configureReaderSelectionGesture } from '../../src/features/reader/hooks/selection/selection-gesture';

function configuredGesture() {
  const gesture = {
    minDistance: vi.fn().mockReturnThis(),
    failOffsetX: vi.fn().mockReturnThis(),
    failOffsetY: vi.fn().mockReturnThis(),
    maxPointers: vi.fn().mockReturnThis(),
    activateAfterLongPress: vi.fn().mockReturnThis(),
  };
  expect(configureReaderSelectionGesture(gesture as unknown as PanGesture)).toBe(gesture);
  return gesture;
}

describe('reader selection gesture activation', () => {
  it('requires a 400ms single-finger hold', () => {
    const gesture = configuredGesture();
    expect(gesture.activateAfterLongPress).toHaveBeenCalledWith(400);
    expect(gesture.maxPointers).toHaveBeenCalledWith(1);
  });

  it('fails before activation when either axis exceeds the small movement tolerance', () => {
    const gesture = configuredGesture();
    expect(gesture.failOffsetX).toHaveBeenCalledWith([-4, 4]);
    expect(gesture.failOffsetY).toHaveBeenCalledWith([-4, 4]);
  });

  it('prevents movement from activating the selection before the hold timer, including diagonals', () => {
    const gesture = configuredGesture();
    const minimumDistance = gesture.minDistance.mock.calls[0][0] as number;
    const horizontalBounds = gesture.failOffsetX.mock.calls[0][0] as [number, number];
    const verticalBounds = gesture.failOffsetY.mock.calls[0][0] as [number, number];
    for (const horizontal of horizontalBounds) {
      for (const vertical of verticalBounds) {
        expect(Math.hypot(horizontal, vertical)).toBeLessThan(minimumDistance);
      }
    }
  });
});
