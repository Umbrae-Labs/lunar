import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProgressDrawer } from '../../src/features/reader/components/bottom-tabs/progress-drawer';
import type { ReaderSnapshot } from '../../src/reader';
import type { LunarReaderRuntime } from '../../src/reader/native';

const { runtime } = vi.hoisted(() => ({
  runtime: {
    onUI: false,
    page: 25,
    reads: 0,
    updater: undefined as undefined | (() => { text: string; accessibilityLabel: string }),
  },
}));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: () => null,
}));
vi.mock('react-native-reanimated', () => ({
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => {
    runtime.page = value;
    return {
      get value() {
        if (!runtime.onUI) throw new Error('Shared value read during render');
        runtime.reads++;
        return runtime.page;
      },
    };
  },
  useAnimatedProps: (updater: typeof runtime.updater) => {
    runtime.updater = updater;
    return updater!();
  },
}));
vi.mock('react-native-worklets', () => ({ isUIRuntime: () => runtime.onUI }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('uniwind', () => ({
  ScopedTheme: ({ children }: { children: ReactNode }) => children,
  useUniwind: () => ({ theme: 'light' }),
}));
vi.mock('heroui-native/toast', () => ({ useToast: () => ({ toast: { show: vi.fn() } }) }));
vi.mock('heroui-native/button', () => ({ Button: () => null }));
vi.mock('heroui-native/bottom-sheet', () => {
  const Container = ({ children }: { children: ReactNode }) => children;
  return { BottomSheet: Object.assign(Container, { Portal: Container, Content: Container, Overlay: () => null, Title: Container }) };
});
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#000000' }) }));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../src/features/reader/services/reading-time-service', () => ({ listReadingSessions: vi.fn() }));
vi.mock('../../src/features/reader/components/reader-progress-slider', () => ({ ReaderProgressSlider: () => null }));
vi.mock('../../src/features/reader/components/bottom-tabs/constants', () => ({ getReaderBottomTabBarInset: () => 48 }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  runtime.onUI = false;
  runtime.reads = 0;
});
afterEach(() => vi.unstubAllGlobals());

it('initializes the percentage from props and only reads live progress on the UI runtime', () => {
  const snapshot = { bookId: 'book', revisionId: 1, bookSpreadIndex: 25, totalSpreads: 101 } as ReaderSnapshot;
  expect(() => renderToStaticMarkup(<ProgressDrawer bookId="book" isOpen onOpenChange={vi.fn()}
    snapshot={snapshot} runtime={{} as LunarReaderRuntime} />)).not.toThrow();
  expect(runtime.reads).toBe(0);
  expect(runtime.updater!().text).toBe('25%');
  runtime.onUI = true;
  runtime.page = 70;
  expect(runtime.updater!().text).toBe('70%');
  expect(runtime.reads).toBe(1);
  runtime.onUI = false;
  expect(runtime.updater!().text).toBe('25%');
  expect(runtime.reads).toBe(1);
});
