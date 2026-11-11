import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-gesture-handler', () => ({ Gesture: {} }));
vi.mock('react-native-reanimated', () => ({ useSharedValue: (value: unknown) => ({ value }) }));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: vi.fn() }));
vi.mock('../../src/reader/skia/anime/native/pager-compositor', () => ({ consumeNativePagerInputOnUI: vi.fn() }));

const { pageTurnTapBlocked, pageTurnTapDirection } = await import(
  '../../src/reader/skia/anime/gesture/use-page-turn-tap-gesture'
);

describe('a tap the composer may turn the page for', () => {
  it('turns back on the left third, forward on the right, and leaves the middle to the controls', () => {
    expect(pageTurnTapDirection(50, 400)).toBe(-1);
    expect(pageTurnTapDirection(200, 400)).toBe(0);
    expect(pageTurnTapDirection(350, 400)).toBe(1);
  });

  it('leaves taps on links, footnotes, images and highlights to RN, with their press slop', () => {
    const regions = [300, 100, 40, 20, 20, 500, 60, 30];
    expect(pageTurnTapBlocked(regions, 320, 110)).toBe(true);
    expect(pageTurnTapBlocked(regions, 345, 125)).toBe(true);
    expect(pageTurnTapBlocked(regions, 350, 110)).toBe(false);
    expect(pageTurnTapBlocked(regions, 50, 520)).toBe(true);
    expect(pageTurnTapBlocked([], 50, 520)).toBe(false);
  });
});
