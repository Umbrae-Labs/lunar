import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkletSliderProps } from '../../src/components/ui/worklet-slider';

const require = createRequire(import.meta.url);
const babelRequire = createRequire(require.resolve('babel-preset-expo'));
const babel = babelRequire('@babel/core');

// Evaluate the generated UI code and recursively transfer its closure. Calling
// the original JS function hides helpers captured before their initialization.
function setup(isDev: boolean, overrides: Partial<WorkletSliderProps> = {}) {
  const filename = resolve('src/components/ui/worklet-slider.tsx');
  const source = readFileSync(filename, 'utf8');
  const code = babel.transformSync(source, {
    filename,
    caller: { name: 'metro', platform: 'android', isDev, supportsStaticESM: false, supportsReactCompiler: true },
  }).code;
  const effects: (() => void)[] = [];
  const handlers = new Map<string, (...args: any[]) => void>();
  const sharedValues = new WeakSet<object>();
  const hostFunctions = new Set<Function>();
  const remoteFunctions = new WeakMap<Function, Function>();
  const styles: (() => any)[] = [];
  let onUI = false;

  function shared(value: number | boolean) {
    const result = { value, set(next: number | boolean) { this.value = next; } };
    sharedValues.add(result);
    return result;
  }

  function transfer(value: any): any {
    if (value === null || !['object', 'function'].includes(typeof value)) return value;
    if (sharedValues.has(value) || hostFunctions.has(value)) return value;
    if (typeof value === 'function') {
      if (!value.__workletHash) {
        const remote = () => { throw new Error('UI callback called a JS-only function'); };
        remoteFunctions.set(remote, value);
        return remote;
      }
      const fn = runInThisContext(`(${value.__initData.code})`);
      return fn.bind({ __closure: transfer(value.__closure) });
    }
    if (Array.isArray(value)) return value.map(transfer);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transfer(item)]));
  }

  function onUIRuntime(callback: (...args: any[]) => any, ...args: any[]) {
    onUI = true;
    try { return transfer(callback)(...args); } finally { onUI = false; }
  }

  const isUIRuntime = () => onUI;
  const scheduleOnRN = (callback: Function, ...args: any[]) => (remoteFunctions.get(callback) ?? callback)(...args);
  hostFunctions.add(isUIRuntime);
  hostFunctions.add(scheduleOnRN);
  const gesture: Record<string, any> = {};
  for (const key of ['enabled', 'activeOffsetX', 'failOffsetY', 'maxPointers']) gesture[key] = () => gesture;
  for (const key of ['onBegin', 'onUpdate', 'onEnd', 'onFinalize']) {
    gesture[key] = (callback: (...args: any[]) => void) => {
      handlers.set(key, (...args) => onUIRuntime(callback, ...args));
      return gesture;
    };
  }

  const Container = ({ children }: { children?: ReactNode }) => children;
  let onLayout!: (event: { nativeEvent: { layout: { width: number } } }) => void;
  const Slider = Object.assign(Container, {
    Track: (props: any) => { onLayout = props.onLayout; return props.children; },
    Fill: () => null,
    Thumb: () => null,
  });
  const load = (name: string) => {
    if (name === 'react') return { ...React, useEffect: (effect: () => void) => { effects.push(effect); } };
    if (name === 'react-native') return { I18nManager: { isRTL: false } };
    if (name === 'heroui-native/slider') return { Slider };
    if (name === 'react-native-gesture-handler') return { Gesture: { Pan: () => gesture }, GestureDetector: Container };
    if (name === 'react-native-worklets') return { isUIRuntime, scheduleOnRN, runOnUI: (fn: Function) => (...args: any[]) => onUIRuntime(fn as any, ...args) };
    if (name === 'react-native-reanimated') return {
      __esModule: true,
      default: { createAnimatedComponent: (component: unknown) => component },
      useSharedValue: shared,
      useAnimatedStyle: (updater: () => unknown) => { styles.push(() => onUIRuntime(updater)); return updater(); },
    };
    return babelRequire(name);
  };
  const module = { exports: {} as { WorkletSlider: React.ComponentType<WorkletSliderProps> } };
  runInThisContext(`(function(require, module, exports, __DEV__) {${code}\n})`, { filename })(load, module, module.exports, isDev);
  const preview = shared(overrides.value ?? 25);
  const onChangeEnd = vi.fn();
  renderToStaticMarkup(React.createElement(module.exports.WorkletSlider, {
    accessibilityLabel: 'Value', value: 25, minValue: 0, maxValue: 100, step: 1,
    previewValue: preview as any, onChangeEnd, ...overrides,
  }));
  effects.forEach((effect) => effect());
  const layout = (width: number) => onLayout({ nativeEvent: { layout: { width } } });
  return { layout, handlers, preview, onChangeEnd, styles };
}

describe.each([true, false])('Android slider worklets, development=%s', (isDev) => {
  it('runs mount, layout and drag callbacks after closure transfer', () => {
    const { layout, handlers, preview, onChangeEnd, styles } = setup(isDev);
    layout(228);
    expect(preview.value).toBe(25);
    handlers.get('onBegin')!();
    handlers.get('onUpdate')!({ translationX: 100 });
    expect(preview.value).toBe(75);
    expect(onChangeEnd).not.toHaveBeenCalled();
    expect(styles[1]()).toEqual({ start: 0, transform: [{ translateX: 150 }] });
    handlers.get('onEnd')!({ translationX: 110 }, true);
    handlers.get('onFinalize')!({}, true);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith(80);
  });

  it('keeps fractional ranges finite and restores the preview after cancellation', () => {
    const { layout, handlers, preview, onChangeEnd } = setup(isDev, { value: 0.5, minValue: 0.05, maxValue: 0.8, step: 0.01 });
    layout(228);
    handlers.get('onBegin')!();
    handlers.get('onUpdate')!({ translationX: -500 });
    expect(preview.value).toBeCloseTo(0.05);
    handlers.get('onFinalize')!({}, false);
    expect(preview.value).toBeCloseTo(0.5);
    expect(onChangeEnd).not.toHaveBeenCalled();
    layout(0);
    handlers.get('onBegin')!();
    handlers.get('onUpdate')!({ translationX: 20 });
    expect(Number.isFinite(preview.value)).toBe(true);
    handlers.get('onEnd')!({ translationX: 20 }, true);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith(0.05);
  });
});
