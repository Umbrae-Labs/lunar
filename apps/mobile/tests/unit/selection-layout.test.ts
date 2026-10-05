import { describe, expect, it, vi } from 'vitest';

import { computeSelectionLayout } from '../../src/features/reader/components/controls/selection';

// Layout calculations use plain rectangles; native components are not rendered.
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useAnimatedStyle: vi.fn(),
  FadeIn: { duration: vi.fn().mockReturnValue({}) },
  FadeOut: { duration: vi.fn().mockReturnValue({}) },
}));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('react-native-gesture-handler', () => ({ Gesture: {}, GestureDetector: 'GestureDetector' }));
vi.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));
vi.mock('heroui-native/button', () => ({ Button: 'Button' }));
vi.mock('heroui-native/hooks', () => ({ useThemeColor: vi.fn() }));
vi.mock('uniwind', () => ({ useCSSVariable: vi.fn() }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));

const insets = { top: 40, right: 0, bottom: 24, left: 0 };

describe('reader selection controls layout', () => {
  it('places the toolbar above a selection with enough space', () => {
    const layout = computeSelectionLayout([{ x: 100, y: 300, width: 120, height: 24 }], 390, 844, insets);
    expect(layout?.toolbar).toMatchObject({ left: 12, top: 180, width: 320, placement: 'above', compact: false });
    expect(layout?.startHandle).toEqual({ x: 100, y: 324 });
    expect(layout?.endHandle).toEqual({ x: 220, y: 324 });
  });

  it('places the toolbar below a selection near the top edge', () => {
    const layout = computeSelectionLayout([{ x: 8, y: 54, width: 50, height: 24 }], 320, 640, insets);
    expect(layout?.toolbar).toMatchObject({ left: 12, top: 90, width: 296, placement: 'below', compact: true });
  });

  it('keeps the toolbar inside horizontal viewport padding', () => {
    const layout = computeSelectionLayout([{ x: 300, y: 300, width: 18, height: 20 }], 320, 640, insets);
    expect(layout?.toolbar.left).toBe(12);
  });

  it('accounts for enlarged text and both horizontal safe areas', () => {
    const layout = computeSelectionLayout(
      [{ x: 500, y: 700, width: 60, height: 30 }],
      600,
      844,
      { ...insets, left: 40, right: 40 },
      200,
    )!;
    expect(layout.toolbar).toMatchObject({ left: 228, top: 488, width: 320, placement: 'above' });
    expect(layout.toolbar.arrowLeft).toBeLessThanOrEqual(290);
  });

  it('keeps a tall selection toolbar within the vertical safe area', () => {
    const layout = computeSelectionLayout([{ x: 20, y: 60, width: 260, height: 520 }], 320, 640, insets)!;
    expect(layout.toolbar.top).toBeGreaterThanOrEqual(52);
    expect(layout.toolbar.top + 156).toBeLessThanOrEqual(604);
  });
});
