import { describe, expect, it, vi } from 'vitest';
import { useReaderSelectionDrag } from '../../src/features/reader/hooks/selection/use-reader-selection-drag';
import { createReaderTextSelectionFromRange, type ReaderRect } from '@/reader';

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
  it('paints Rito font boxes during a drag and ignores a preview delivered after release', async () => {
    const entries = [0, 30].map((y) => ({ pageIndex: 0, bounds: { x: 0, y, width: 100, height: 30 }, text: '正文' }));
    const range = { start: { entryIndex: 0, charIndex: 0 }, end: { entryIndex: 1, charIndex: 2 } };
    const selection = createReaderTextSelectionFromRange(entries, range)!;
    const fontBoxes = entries.map(({ bounds }) => ({ ...bounds, y: bounds.y + 5, height: 20 }));
    const requests: ((boxes: readonly ReaderRect[]) => void)[] = [];
    const resolveSelectionBounds = vi.fn(() => new Promise<readonly ReaderRect[]>((resolve) => requests.push(resolve)));
    const onCommit = vi.fn();
    const drag = useReaderSelectionDrag({ entries, pageKey: 'page', resolveSelectionBounds, onCommit });
    drag.begin('extend', 100, 45);
    drag.initialize(selection);
    expect(drag.binding.rects.value).toEqual([]);
    requests[0](fontBoxes);
    await vi.waitFor(() => expect(drag.binding.rects.value).toEqual(fontBoxes));
    drag.finish(false);
    expect(onCommit).toHaveBeenCalledWith(range, { x: 100, y: 45 }, 'page');

    drag.begin('end');
    drag.moveHandle('end', -50, 0);
    drag.finish(false);
    requests[1]([fontBoxes[0]]);
    await Promise.resolve();
    expect(drag.binding.rects.value).toEqual(fontBoxes);
  });
});
