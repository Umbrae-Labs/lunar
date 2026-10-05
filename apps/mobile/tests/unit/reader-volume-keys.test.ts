import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReaderVolumeKeys } from '../../src/features/reader/hooks/controls/use-reader-volume-keys';
import { subscribeToReaderVolumeKeys } from '../../src/features/reader/infrastructure/reader-volume-keys';

type Direction = 'next' | 'previous';
const state = vi.hoisted(() => ({
  ref: { current: undefined as unknown },
  dependencies: undefined as readonly unknown[] | undefined,
  callback: undefined as (() => void | (() => void)) | undefined,
  focusedCallback: undefined as (() => void | (() => void)) | undefined,
  cleanup: undefined as (() => void) | undefined,
  focused: true,
  listener: undefined as ((direction: Direction) => void) | undefined,
  unsubscribe: vi.fn(),
}));

vi.mock('react', () => ({
  useRef: () => state.ref,
  useLayoutEffect: (effect: () => void) => effect(),
  useCallback: (callback: () => void | (() => void), dependencies: readonly unknown[]) => {
    if (!state.dependencies || dependencies.some((value, index) => value !== state.dependencies![index])) {
      state.dependencies = dependencies;
      state.callback = callback;
    }
    return state.callback;
  },
}));

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const activeCallback = state.focused ? callback : undefined;
    if (activeCallback === state.focusedCallback) return;
    state.cleanup?.();
    state.focusedCallback = activeCallback;
    state.cleanup = activeCallback?.() || undefined;
  },
}));

vi.mock('../../src/features/reader/infrastructure/reader-volume-keys', () => ({
  subscribeToReaderVolumeKeys: vi.fn((listener: (direction: Direction) => void) => {
    state.listener = listener;
    return state.unsubscribe;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.ref.current = undefined;
  state.dependencies = undefined;
  state.callback = undefined;
  state.focusedCallback = undefined;
  state.cleanup = undefined;
  state.listener = undefined;
  state.focused = true;
});

describe('reader volume key subscription', () => {
  it('keeps interception active across callback changes and uses the latest navigation handler', () => {
    const next = vi.fn();
    const previous = vi.fn();
    useReaderVolumeKeys(true, (direction) => {
      if (direction === 'next') next();
    });
    state.listener?.('next');
    expect(next).toHaveBeenCalledTimes(1);

    // A settling render consumes the second press without requesting another turn.
    useReaderVolumeKeys(true, () => {});
    state.listener?.('next');
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.unsubscribe).not.toHaveBeenCalled();

    useReaderVolumeKeys(true, (direction) => {
      if (direction === 'previous') previous();
    });
    state.listener?.('previous');
    expect(previous).toHaveBeenCalledTimes(1);
    expect(subscribeToReaderVolumeKeys).toHaveBeenCalledTimes(1);
    expect(state.unsubscribe).not.toHaveBeenCalled();
  });

  it('releases interception when the setting is disabled and subscribes again when enabled', () => {
    const onPress = vi.fn();
    useReaderVolumeKeys(false, onPress);
    expect(subscribeToReaderVolumeKeys).not.toHaveBeenCalled();
    useReaderVolumeKeys(true, onPress);
    useReaderVolumeKeys(false, onPress);
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    useReaderVolumeKeys(true, onPress);
    expect(subscribeToReaderVolumeKeys).toHaveBeenCalledTimes(2);
  });

  it('releases interception on blur and restores it on focus', () => {
    const onPress = vi.fn();
    useReaderVolumeKeys(true, onPress);
    state.focused = false;
    useReaderVolumeKeys(true, onPress);
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
    state.focused = true;
    useReaderVolumeKeys(true, onPress);
    expect(subscribeToReaderVolumeKeys).toHaveBeenCalledTimes(2);
  });
});
