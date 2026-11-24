import { describe, expect, it, vi } from 'vitest';
import { useReaderSelectionDrag } from '../../src/features/reader/hooks/selection/use-reader-selection-drag';
import { createReaderTextSelectionFromRange } from '@/reader';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void) => effect(),
}));
vi.mock('react-native-reanimated', () => ({
  useSharedValue: <T>(value: T) => ({
    value,
    set(next: T) {
      this.value = next;
    },
  }),
}));
vi.mock('react-native-worklets', () => ({
  runOnUI: (callback: unknown) => callback,
  scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args),
}));

describe('reader selection drag', () => {
  it('fills consecutive lines on the UI thread and submits only the final range', () => {
    const entries = [0, 30].map((y, lineIndex) => {
      const pos = { blockIndex: 0, lineIndex, runIndex: 0 };
      return {
        pageIndex: 0,
        bounds: { x: 0, y, width: 100, height: 20 },
        text: '正文',
        textRange: { start: { ...pos, charIndex: 0 }, end: { ...pos, charIndex: 2 } },
      };
    });
    const range = { start: { entryIndex: 0, charIndex: 0 }, end: { entryIndex: 1, charIndex: 2 } };
    const selection = createReaderTextSelectionFromRange(entries, range)!;
    const onCommit = vi.fn();
    const drag = useReaderSelectionDrag({ entries, pageKey: 'page', onCommit });
    drag.begin('extend', 100, 45);
    drag.initialize(selection);
    expect(drag.binding.rects.value).toEqual([
      { x: 0, y: 0, width: 100, height: 25 },
      { x: 0, y: 25, width: 100, height: 25 },
    ]);
    expect(drag.binding.rects.value).toEqual(selection.bounds);
    expect(onCommit).not.toHaveBeenCalled();
    drag.finish(false);
    expect(onCommit).toHaveBeenCalledWith(range, { x: 100, y: 45 }, 'page');

    drag.begin('end');
    drag.moveHandle('end', -50, 0);
    expect(drag.binding.rects.value[1]).toEqual({ x: 0, y: 25, width: 50, height: 25 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    drag.finish(false);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
