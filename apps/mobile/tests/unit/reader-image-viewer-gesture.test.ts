import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/components/ui/image-viewer';

type GestureEvent = Record<string, number>;
type GestureCallback = (event: GestureEvent, success: boolean) => void;

const harness = vi.hoisted(() => ({
  gestures: [] as { kind: string; callbacks: Record<string, GestureCallback> }[],
  effects: [] as (() => unknown)[],
  styles: [] as (() => { transform?: Record<string, number>[] })[],
  completions: [] as ((finished: boolean) => void)[],
  timing: vi.fn((value: number, _config: unknown, completion?: (finished: boolean) => void) => {
    if (completion) harness.completions.push(completion);
    return value;
  }),
  spring: vi.fn((value: number) => value),
}));

// Run the actual gesture callbacks with deterministic animation completion.
// Native rendering is excluded so failed/cancelled gesture ordering can be exercised.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [{ width: 400, height: 600 }, vi.fn()],
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('heroui-native/close-button', () => ({ CloseButton: 'CloseButton' }));
vi.mock('uniwind', () => ({ withUniwind: (component: unknown) => component }));
vi.mock('react-native', () => ({
  View: 'View',
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: () => void) => callback() }));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  cancelAnimation: vi.fn(),
  Easing: { cubic: (value: number) => value, out: (easing: unknown) => easing },
  Extrapolation: { CLAMP: 'clamp' },
  interpolate: (value: number, input: number[], output: number[]) =>
    output[0] + (output.at(-1)! - output[0]) * (value - input[0]) / (input.at(-1)! - input[0]),
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (factory: () => { transform?: Record<string, number>[] }) => {
    harness.styles.push(factory);
    return {};
  },
  withTiming: harness.timing,
  withSpring: harness.spring,
}));
vi.mock('react-native-gesture-handler', () => {
  const create = (kind: string) => {
    const callbacks: Record<string, GestureCallback> = {};
    const gesture = {
      kind, callbacks,
      enabled: () => gesture,
      maxPointers: () => gesture,
      minDistance: () => gesture,
      numberOfTaps: () => gesture,
      onStart: (callback: GestureCallback) => { callbacks.start = callback; return gesture; },
      onUpdate: (callback: GestureCallback) => { callbacks.update = callback; return gesture; },
      onEnd: (callback: GestureCallback) => { callbacks.end = callback; return gesture; },
      onFinalize: (callback: GestureCallback) => { callbacks.finalize = callback; return gesture; },
    };
    harness.gestures.push(gesture);
    return gesture;
  };
  return {
    GestureDetector: 'GestureDetector',
    Gesture: {
      Pinch: () => create('pinch'), Pan: () => create('pan'), Tap: () => create('tap'),
      Simultaneous: (...gestures: unknown[]) => gestures,
      Exclusive: (...gestures: unknown[]) => gestures,
    },
  };
});

function emit(kind: string, phase: string, event: GestureEvent = {}, success = true, index = 0) {
  harness.gestures.filter((gesture) => gesture.kind === kind)[index].callbacks[phase](event, success);
}

function transform() {
  return Object.assign({}, ...harness.styles.map((style) => style()).find((style) => style.transform)?.transform);
}

function openViewer() {
  const onClose = vi.fn();
  ImageViewer({
    uri: 'file:///image.png', description: 'Image', closeLabel: 'Close', onClose, onError: vi.fn(),
    origin: { x: 40, y: 120, width: 320, height: 480 }, viewport: { width: 400, height: 800 },
  });
  harness.effects.forEach((effect) => effect());
  harness.timing.mockClear();
  return onClose;
}

beforeEach(() => {
  harness.gestures.length = 0;
  harness.effects.length = 0;
  harness.styles.length = 0;
  harness.completions.length = 0;
  vi.clearAllMocks();
});

describe('image viewer gesture ownership', () => {
  it('keeps a failed pan from replacing double-tap zoom with a spring', () => {
    openViewer();
    emit('tap', 'end', { x: 100, y: 300 });
    const zoom = transform();
    emit('pan', 'finalize', { numberOfPointers: 0 }, false);
    expect(transform()).toEqual(zoom);
    expect(zoom.scale).toBe(2.5);
    expect(harness.spring).not.toHaveBeenCalled();
    expect(harness.timing.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ duration: 240 }), expect.objectContaining({ duration: 240 }),
      expect.objectContaining({ duration: 240 }),
    ]);
  });

  it('tracks a moving pinch center and ignores competing pan finalization', () => {
    openViewer();
    emit('pinch', 'start', { scale: 1, focalX: 140, focalY: 300, numberOfPointers: 2 });
    emit('pinch', 'update', { scale: 2, focalX: 160, focalY: 320, numberOfPointers: 2 });
    expect(transform()).toMatchObject({ scale: 2, translateX: 80, translateY: 120 });
    emit('pan', 'finalize', { numberOfPointers: 1 }, false);
    expect(harness.spring).not.toHaveBeenCalled();
    emit('pinch', 'update', { scale: 2, focalX: 180, focalY: 340, numberOfPointers: 2 });
    expect(transform()).toMatchObject({ scale: 2, translateX: 100, translateY: 140 });
  });

  it('preserves the transform when the pinch pointer count changes', () => {
    openViewer();
    emit('pinch', 'start', { scale: 1, focalX: 200, focalY: 400, numberOfPointers: 2 });
    emit('pinch', 'update', { scale: 2, focalX: 220, focalY: 420, numberOfPointers: 2 });
    const before = transform();
    emit('pinch', 'update', { scale: 2.2, focalX: 300, focalY: 500, numberOfPointers: 3 });
    expect(transform()).toEqual(before);
    emit('pinch', 'update', { scale: 2.2, focalX: 310, focalY: 510, numberOfPointers: 3 });
    expect(transform()).toMatchObject({ scale: 2, translateX: 30, translateY: 30 });
  });

  it('keeps a valid pinch transform unchanged when fingers lift', () => {
    openViewer();
    emit('pinch', 'start', { scale: 1, focalX: 200, focalY: 400, numberOfPointers: 2 });
    emit('pinch', 'update', { scale: 2, focalX: 230, focalY: 440, numberOfPointers: 2 });
    emit('pinch', 'finalize');
    expect(transform()).toMatchObject({ scale: 2, translateX: 30, translateY: 40 });
    expect(harness.spring).not.toHaveBeenCalled();
  });

  it('finishes swipe dismissal once and ignores subsequent load effects', () => {
    const onClose = openViewer();
    emit('pan', 'start', { translationX: 0, translationY: 4, numberOfPointers: 1 });
    emit('pan', 'update', { translationX: 0, translationY: 200, numberOfPointers: 1 });
    emit('pan', 'end', { translationY: 200, velocityY: 200, numberOfPointers: 0 });
    expect(onClose).not.toHaveBeenCalled();
    const animations = harness.timing.mock.calls.length;
    harness.effects[0]();
    emit('pan', 'finalize', { numberOfPointers: 0 }, false);
    expect(harness.timing).toHaveBeenCalledTimes(animations);
    expect(harness.spring).not.toHaveBeenCalled();
    harness.completions.forEach((complete) => complete(true));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses black-area taps while leaving image taps open', () => {
    const onClose = openViewer();
    emit('tap', 'end', { x: 200, y: 400 }, true, 1);
    expect(harness.completions).toHaveLength(0);
    emit('tap', 'end', { x: 200, y: 40 }, true, 1);
    harness.completions.forEach((complete) => complete(true));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
