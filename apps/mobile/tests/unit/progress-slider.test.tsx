import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressSlider } from '../../src/features/reader/components/controls/progress-slider';
import type { SharedValue } from 'react-native-reanimated';

const { handlers, layout, runtime } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  layout: { callback: undefined as undefined | ((event: { nativeEvent: { layout: { width: number } } }) => void) },
  runtime: { rendering: false, styles: [] as (() => unknown)[] },
}));

vi.mock('react-native', () => ({ I18nManager: { isRTL: false } }));
vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (initial: unknown) => {
    let value = initial;
    return {
      get value() {
        if (runtime.rendering) throw new Error('Shared value read during render');
        return value;
      },
      set(next: unknown) {
        value = next;
      },
    };
  },
  useAnimatedStyle: (updater: () => unknown) => {
    runtime.styles.push(updater);
    runtime.rendering = true;
    try {
      return updater();
    } finally {
      runtime.rendering = false;
    }
  },
}));
vi.mock('react-native-worklets', () => ({
  isUIRuntime: () => !runtime.rendering,
  runOnUI: (callback: (...args: any[]) => void) => callback,
  scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args),
}));
vi.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const gesture = {
        enabled: () => gesture,
        activeOffsetX: () => gesture,
        failOffsetY: () => gesture,
        maxPointers: () => gesture,
        onBegin: (callback: () => void) => {
          handlers.set('begin', callback);
          return gesture;
        },
        onUpdate: (callback: (event: { translationX: number }) => void) => {
          handlers.set('update', callback);
          return gesture;
        },
        onEnd: (callback: (event: { translationX: number }, success: boolean) => void) => {
          handlers.set('end', callback);
          return gesture;
        },
        onFinalize: (callback: (event: unknown, success: boolean) => void) => {
          handlers.set('finalize', callback);
          return gesture;
        },
      };
      return gesture;
    },
  },
  GestureDetector: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('heroui-native/slider', () => {
  const Container = ({ children }: { children: ReactNode }) => children;
  const Track = ({ children, onLayout }: { children: ReactNode; onLayout: typeof layout.callback }) => {
    layout.callback = onLayout;
    return children;
  };
  return { Slider: Object.assign(Container, { Track, Fill: () => null, Thumb: () => null }) };
});

beforeEach(() => {
  vi.stubGlobal('React', React);
  handlers.clear();
  runtime.styles = [];
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const previewPage = {
    value: 25,
    set(next: number) {
      this.value = next;
    },
  } as unknown as SharedValue<number>;
  const onChangeEnd = vi.fn();
  const onDragBegin = vi.fn();
  const onDragCancel = vi.fn();
  renderToStaticMarkup(
    <ProgressSlider
      accessibilityLabel="Page"
      value={25}
      maxValue={100}
      isDisabled={false}
      previewPage={previewPage}
      onDragBegin={onDragBegin}
      onDragCancel={onDragCancel}
      onChangeEnd={onChangeEnd}
    />,
  );
  layout.callback!({ nativeEvent: { layout: { width: 228 } } });
  return { onChangeEnd, onDragBegin, onDragCancel, previewPage };
}

describe('reader progress slider gesture boundaries', () => {
  it('initializes animation styles without reading shared values during render', () => {
    expect(() => setup()).not.toThrow();
    runtime.rendering = true;
    try {
      expect(runtime.styles[0]()).toEqual({ start: 0, width: 28 });
      expect(runtime.styles[1]()).toEqual({ start: 0, transform: [{ translateX: 0 }] });
    } finally {
      runtime.rendering = false;
    }
    handlers.get('begin')!();
    handlers.get('update')!({ translationX: 100 });
    expect(runtime.styles[0]()).toEqual({ start: 0, width: 178 });
    expect(runtime.styles[1]()).toEqual({ start: 0, transform: [{ translateX: 150 }] });
  });
  it('keeps continuous drag samples local and submits once on release', () => {
    const { onChangeEnd, onDragBegin, previewPage } = setup();
    handlers.get('begin')!();
    for (let translationX = 0; translationX <= 100; translationX++) handlers.get('update')!({ translationX });
    expect(onDragBegin).toHaveBeenCalledOnce();
    expect(onChangeEnd).not.toHaveBeenCalled();
    expect(previewPage.value).toBe(75);
    handlers.get('end')!({ translationX: 100 }, true);
    handlers.get('finalize')!({}, true);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith(75);
  });

  it('uses the final release coordinate and clamps to the last page', () => {
    const { onChangeEnd } = setup();
    handlers.get('begin')!();
    handlers.get('update')!({ translationX: 20 });
    handlers.get('end')!({ translationX: 500 }, true);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith(100);
  });

  it('cancels a failed gesture without submitting a page', () => {
    const { onChangeEnd, onDragCancel, previewPage } = setup();
    handlers.get('begin')!();
    handlers.get('update')!({ translationX: 100 });
    handlers.get('end')!({ translationX: 100 }, false);
    handlers.get('finalize')!({}, false);
    expect(onChangeEnd).not.toHaveBeenCalled();
    expect(onDragCancel).toHaveBeenCalledOnce();
    expect(previewPage.value).toBe(25);
  });
});
