import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../src/i18n/translations/en';
import { zhCN } from '../../src/i18n/translations/zh-CN';
import { StatisticsScreen } from '../../src/features/statistics/screens/statistics-screen';

const state = vi.hoisted(() => ({
  cells: [] as unknown[],
  cursor: 0,
  locale: 'en',
  focus: undefined as undefined | (() => () => void),
  appState: undefined as undefined | ((state: string) => void),
  actions: new Map<string, () => void>(),
  longActions: new Map<string, () => void>(),
  dayChildren: [] as ReactNode[],
  sheetChildren: undefined as ReactNode,
  load: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  period: undefined as unknown,
  applyRange: undefined as undefined | ((range: { start: string; end: string }) => void),
}));
vi.mock('../../src/features/statistics/components/reading-trend', () => ({
  ReadingTrend: ({ daily }: { daily: unknown }) => <div>{JSON.stringify(daily)}</div>,
}));
vi.mock('../../src/features/statistics/components/period-books', () => ({
  PeriodBooks: ({ period }: { period: unknown }) => {
    state.period = period;
    return <div>{JSON.stringify(period)}</div>;
  },
}));
vi.mock('../../src/features/statistics/components/date-range-sheet', () => ({
  DateRangeSheet: ({ onApply }: { onApply: typeof state.applyRange }) => {
    state.applyRange = onApply;
    return null;
  },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.cells)) state.cells[index] = typeof initial === 'function' ? initial() : initial;
    return [
      state.cells[index],
      (next: unknown) => {
        state.cells[index] = typeof next === 'function' ? next(state.cells[index]) : next;
      },
    ];
  },
  useEffectEvent: (callback: unknown) => callback,
  useEffect: (callback: () => void) => callback(),
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: state.push, navigate: state.navigate }),
  useFocusEffect: (callback: () => () => void) => {
    state.focus = callback;
  },
}));
vi.mock('react-native-reanimated', async () => {
  const { useRef } = await import('react');
  const { ScrollView, Text } = await import('react-native');
  return {
    default: { ScrollView, Text },
    useAnimatedRef: () => useRef(null),
    useScrollOffset: () => ({ value: 0 }),
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
  };
});
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ScrollView: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  useWindowDimensions: () => ({ width: 411, height: 914, fontScale: 1 }),
  PanResponder: { create: () => ({ panHandlers: {} }) },
  ActivityIndicator: () => <span>loading</span>,
  BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
  AppState: {
    addEventListener: (_: string, handler: (value: string) => void) => {
      state.appState = handler;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('expo-image', () => ({ Image: () => <span>cover</span> }));
vi.mock('uniwind', () => ({
  withUniwind: (component: unknown) => component,
  useResolveClassNames: () => ({ color: 'blue' }),
}));
vi.mock('react-native-svg', () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { default: Part, Circle: Part, Line: Part, Path: Part };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('@/hooks/use-mark-initial-content-ready', () => ({ useMarkInitialContentReady: vi.fn() }));
vi.mock('@/features/reader', async () => import('../../src/features/reader/domain/reading-time'));
vi.mock('../../src/features/statistics/repositories/statistics-repository', () => ({ loadStatistics: state.load }));
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, values?: Record<string, unknown>) => {
      const calendarKeys = ['monthsShort', 'monthsLong', 'weekdaysShort', 'weekdaysLong', 'fullDate', 'dateTitle'];
      const name = key.replace('statistics.', '');
      if (calendarKeys.includes(name)) {
        const calendar = state.locale === 'zh-CN' ? zhCN.statistics : en.statistics;
        return String(calendar[name as keyof typeof calendar]).replace(/{{(\w+)}}/g, (_, field: string) =>
          String(values?.[field] ?? ''),
        );
      }
      return `${key}${values ? JSON.stringify(values) : ''}`;
    },
  }),
}));
vi.mock('heroui-native/toast', () => ({ useToast: () => ({ toast: { show: state.toast } }) }));
vi.mock('heroui-native/button', () => {
  const Control = ({
    children,
    accessibilityLabel,
    onPress,
    onLongPress,
    isDisabled,
  }: {
    children: ReactNode;
    accessibilityLabel?: string;
    onPress: () => void;
    onLongPress?: () => void;
    isDisabled?: boolean;
  }) => {
    const name = accessibilityLabel ?? String(children);
    if (!isDisabled) state.actions.set(name, onPress);
    if (onLongPress) {
      state.longActions.set(name, onLongPress);
      state.dayChildren.push(children);
    }
    return <button disabled={isDisabled}>{children}</button>;
  };
  return {
    Button: Object.assign(Control, { Label: ({ children }: { children: ReactNode }) => <span>{children}</span> }),
  };
});
vi.mock('heroui-native/pressable-feedback', async () => {
  const { Button } = await import('heroui-native/button');
  return { PressableFeedback: Button };
});
vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('heroui-native/bottom-sheet', () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const Root = ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => {
    const isDay = (node: ReactNode): boolean =>
      React.Children.toArray(node).some((child) =>
        typeof child === 'string'
          ? child.includes('statistics.daySummary')
          : React.isValidElement<{ children: ReactNode }>(child) && isDay(child.props.children),
      );
    if (isDay(children)) state.sheetChildren = children;
    return isOpen ? <div>{children}</div> : null;
  };
  return {
    BottomSheet: Object.assign(Root, {
      Portal: Part,
      Overlay: () => null,
      Content: Part,
      Title: Part,
      Description: Part,
    }),
  };
});
const data = {
  books: [
    { id: 'book', title: 'Lunar book', author: 'Author', coverUri: 'cover.jpg', progress: 1, milliseconds: 60_000 },
  ],
  total: 60_000,
  average: 60_000,
  completed: 1,
  dayBooks: {
    '2026-10-15': [
      { id: 'book', title: 'Lunar book', author: 'Author', coverUri: 'cover.jpg', progress: 1, milliseconds: 60_000 },
    ],
  },
  daily: [{ date: '2026-10-15', milliseconds: 60_000 }],
};
function render() {
  state.cursor = 0;
  state.actions.clear();
  state.dayChildren = [];
  state.longActions.clear();
  return renderToStaticMarkup(<StatisticsScreen />);
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  state.cells = [];
  state.cursor = 0;
  state.locale = 'en';
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00Z'));
  state.load.mockResolvedValue(data);
});

describe('statistics mobile screen interactions', () => {
  it('updates summary, curve, books and ranking together across presets and custom ranges', async () => {
    render();
    const cleanup = state.focus!();
    await settle();
    render();
    state.actions.get('statistics.period')!();
    let markup = render();
    expect(markup).toContain('statistics.periodSummary');
    expect(state.period).toMatchObject({
      total: 60_000,
      readingDays: 1,
      books: [{ id: 'book', milliseconds: 60_000 }],
      ranking: [{ share: 1 }],
    });
    state.applyRange!({ start: '2026-10-01', end: '2026-10-14' });
    markup = render();
    expect(state.period).toMatchObject({ total: 0, average: 0, books: [], ranking: [] });
    expect(markup).not.toContain('Lunar book');
    expect(markup).toContain('2026-10-14');
    state.applyRange!({ start: '2026-10-15', end: '2026-10-15' });
    render();
    expect(state.period).toMatchObject({
      total: 60_000,
      average: 60_000,
      daily: [{ date: '2026-10-15', milliseconds: 60_000 }],
    });
    state.actions.get('statistics.posterEntry')!();
    expect(state.push).toHaveBeenCalledWith({
      pathname: '/statistics-poster',
      params: { start: '2026-10-15', end: '2026-10-15' },
    });
    state.actions.get('statistics.lastDays{"count":7}')!();
    render();
    expect(state.period).toMatchObject({ total: 60_000, average: 60_000 / 7 });
    cleanup();
  });
  it('loads on focus, selects a date and opens the correct book route', async () => {
    expect(render()).toContain('loading');
    const cleanup = state.focus!();
    await settle();
    expect(render()).toContain('statistics.yearSummary');
    const day = [...state.actions.keys()].find((key) => key.startsWith('2026-10-15,'));
    expect(day).toBeDefined();
    state.actions.get(day!)!();
    expect(render()).toContain('October 15, 2026');
    expect(state.dayChildren.every((child) => child === undefined)).toBe(true);
    state.actions.get('statistics.openBook{"title":"Lunar book"}')!();
    expect(state.push).toHaveBeenCalledWith({ pathname: '/reader/[bookId]', params: { bookId: 'book' } });
    cleanup();
  });
  it('opens daily books with a long press and closes with the close action', async () => {
    render();
    const cleanup = state.focus!();
    await settle();
    render();
    const day = [...state.longActions.keys()].find((key) => key.startsWith('2026-10-15,'))!;
    state.longActions.get(day)!();
    expect(render()).toContain('statistics.daySummary{&quot;count&quot;:1}');
    expect(render()).toContain('cover');
    state.actions.get('action.close')!();
    expect(render()).not.toContain('October 15, 2026');
    const closingContent = renderToStaticMarkup(<>{state.sheetChildren}</>);
    expect(closingContent).toContain('October 15, 2026');
    expect(closingContent).toContain('statistics.daySummary{&quot;count&quot;:1}');
    expect(closingContent).toContain('Lunar book');
    cleanup();
  });
  it('shows a daily empty state without inventing books', async () => {
    render();
    const cleanup = state.focus!();
    await settle();
    render();
    const day = [...state.actions.keys()].find((key) => key.startsWith('2026-10-14,'))!;
    state.actions.get(day)!();
    expect(render()).toContain('statistics.dayEmpty');
    expect(render()).toContain('statistics.daySummary{&quot;count&quot;:0}');
    cleanup();
  });
  it('updates calendar and date detail language without restarting the screen', async () => {
    render();
    const cleanup = state.focus!();
    await settle();
    render();
    state.locale = 'zh-CN';
    const markup = render();
    expect(markup).toContain('周日');
    expect(markup).toContain('>7月<');
    for (const month of ['8月', '9月', '10月']) expect(markup).toContain(`>${month}<`);
    const day = [...state.actions.keys()].find((key) => key.startsWith('2026-10-15,'))!;
    state.actions.get(day)!();
    expect(render()).toContain('2026年10月15日');
    cleanup();
  });
  it('refreshes after foregrounding and ignores results after leaving the screen', async () => {
    render();
    const cleanup = state.focus!();
    await settle();
    render();
    state.load.mockResolvedValue({ ...data, total: 120_000 });
    state.appState!('active');
    await settle();
    expect(state.load).toHaveBeenCalledTimes(2);
    expect(state.cells[0]).toMatchObject({ total: 120_000 });
    let resolve!: (value: unknown) => void;
    state.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    state.appState!('active');
    cleanup();
    resolve({ ...data, total: 999 });
    await settle();
    expect(state.cells[0]).toMatchObject({ total: 120_000 });
  });
  it('shows a recoverable error with toast and retries successfully', async () => {
    state.load.mockRejectedValueOnce(new Error('offline'));
    render();
    let cleanup = state.focus!();
    await settle();
    expect(render()).toContain('statistics.error');
    expect(state.toast).toHaveBeenCalledWith({ variant: 'danger', label: 'statistics.error' });
    state.actions.get('statistics.retry')!();
    cleanup();
    render();
    cleanup = state.focus!();
    await settle();
    expect(render()).toContain('statistics.yearSummary');
    expect(state.cells[1]).toBe(false);
    cleanup();
  });
  it('takes an empty library back to the library tab', async () => {
    state.load.mockResolvedValue({ books: [], daily: [], dayBooks: {}, total: 0, average: 0, completed: 0 });
    render();
    const cleanup = state.focus!();
    await settle();
    expect(render()).toContain('statistics.empty');
    state.actions.get('tabs.library')!();
    expect(state.navigate).toHaveBeenCalledWith('/library');
    cleanup();
  });
});
