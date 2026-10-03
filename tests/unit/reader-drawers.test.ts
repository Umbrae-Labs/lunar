import React, { type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarksDrawer } from '../../src/features/reader/components/bottom-tabs/marks-drawer';
import { TocDrawer } from '../../src/features/reader/components/bottom-tabs/toc-drawer';

const { buttons, showToast } = vi.hoisted(() => ({
  buttons: new Map<string, () => void>(),
  showToast: vi.fn(),
}));

vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => React.createElement('span', null, children),
  View: ({ children }: { children: ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('uniwind', () => ({
  ScopedTheme: ({ children }: { children: ReactNode }) => children,
  useCSSVariable: () => '#000000',
  useUniwind: () => ({ theme: 'light' }),
  withUniwind: (component: unknown) => component,
}));
vi.mock('expo-symbols', () => ({
  SymbolView: ({ name }: { name: { web: string } }) => React.createElement('i', { 'data-symbol': name.web }),
}));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/confirm-modal', () => ({ ConfirmModal: () => null }));
vi.mock('../../src/features/reader/components/bottom-tabs/constants', () => ({
  getReaderBottomTabBarInset: () => 48,
}));
vi.mock('heroui-native/toast', () => ({ useToast: () => ({ toast: { show: showToast } }) }));
vi.mock('heroui-native/hooks', () => ({ useThemeColor: () => '#ffffff' }));
vi.mock('heroui-native/pressable-feedback', () => ({
  PressableFeedback: Object.assign(({ children, isDisabled, ...props }: {
    children: React.ReactElement;
    isDisabled?: boolean;
  }) => React.cloneElement(children, { ...props, disabled: isDisabled }), {
    Highlight: () => null,
  }),
}));
vi.mock('react-native-gesture-handler', () => ({
  Pressable: (props: { accessibilityLabel: string; onPress: () => void; children: ReactNode }) => {
    buttons.set(props.accessibilityLabel, props.onPress);
    return props.children;
  },
}));
vi.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  default: ({ children, renderRightActions }: {
    children: ReactNode;
    renderRightActions?: (progress: unknown, translation: unknown, methods: {
      close: () => void;
      openLeft: () => void;
      openRight: () => void;
      reset: () => void;
    }) => ReactNode;
  }) => React.createElement(React.Fragment, null,
    renderRightActions?.({}, {}, {
      close: vi.fn(), openLeft: vi.fn(), openRight: vi.fn(), reset: vi.fn(),
    }), children),
}));
vi.mock('heroui-native/bottom-sheet', () => {
  const Container = ({ children }: { children: ReactNode }) => children;
  const Content = ({ children }: {
    children: ReactNode;
  }) => {
    return children;
  };
  return { BottomSheet: Object.assign(Container, {
    Portal: Container, Content, Overlay: () => null,
    Title: Container, Description: Container,
  }) };
});
vi.mock('heroui-native/button', () => ({
  Button: Object.assign((props: { accessibilityLabel: string; onPress: () => void; children: ReactNode }) => {
    buttons.set(props.accessibilityLabel, props.onPress);
    return props.children;
  }, { Label: ({ children }: { children: ReactNode }) => children }),
}));
vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFlatList: ({ data, renderItem, ListEmptyComponent }: {
    data: unknown[];
    renderItem: (value: { item: unknown }) => ReactNode;
    ListEmptyComponent: ReactNode;
  }) => data.length ? data.map((item, index) =>
    React.createElement(React.Fragment, { key: index }, renderItem({ item }))) : ListEmptyComponent,
}));

beforeEach(() => {
  vi.stubGlobal('React', React);
  buttons.clear();
  showToast.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function marksProps(): ComponentProps<typeof MarksDrawer> {
  return {
    isOpen: true,
    onOpenChange: vi.fn(),
    onNavigated: vi.fn(),
    runtime: { goToLocator: vi.fn().mockResolvedValue({}) } as unknown as ComponentProps<typeof MarksDrawer>['runtime'],
    toc: [],
    bookmarks: [{ id: 'bookmark', bookId: 'book', label: 'Saved chapter', text: 'Saved passage',
      locator: { spineIdref: 'chapter', manifestHref: 'chapter.xhtml', chapterProgress: 0 }, createdAt: 1 }],
    highlights: [],
    bookmarksLoaded: true,
    highlightsLoaded: true,
    onRemoveBookmark: vi.fn(),
    onRemoveHighlight: vi.fn(),
    onOpenNote: vi.fn(),
  };
}

function tocProps(): ComponentProps<typeof TocDrawer> {
  return {
    isOpen: true,
    onOpenChange: vi.fn(),
    runtime: { goToToc: vi.fn().mockResolvedValue({}) } as unknown as ComponentProps<typeof TocDrawer>['runtime'],
    snapshot: { phase: 'ready' } as ComponentProps<typeof TocDrawer>['snapshot'],
    toc: [{ href: 'chapter.xhtml', label: 'Chapter title', children: [] }],
  };
}

describe('reader drawer navigation', () => {
  it('retains bookmarks throughout the closing render', () => {
    const props = marksProps();
    const open = renderToStaticMarkup(React.createElement(MarksDrawer, props));
    const closing = renderToStaticMarkup(React.createElement(MarksDrawer, { ...props, isOpen: false }));
    expect(closing).toBe(open);
    expect(closing).toContain('Saved passage');
    expect(closing).not.toContain('reader.noBookmarks');
  });

  it('renders bookmark deletion as a right-side swipe action with an icon', () => {
    const markup = renderToStaticMarkup(React.createElement(MarksDrawer, marksProps()));
    expect(markup).toContain('data-symbol="delete"');
    expect(markup).not.toContain('action.delete');
    expect(buttons.has('reader.removeBookmark')).toBe(true);
  });

  it('retains the chapter list and count throughout the closing render', () => {
    const props = tocProps();
    const open = renderToStaticMarkup(React.createElement(TocDrawer, props));
    const closing = renderToStaticMarkup(React.createElement(TocDrawer, { ...props, isOpen: false }));
    expect(closing).toBe(open);
    expect(closing).toContain('Chapter title');
    expect(closing).not.toContain('reader.noToc');
  });

  it.each(['marks', 'toc'] as const)('navigates once and closes %s after the jump completes', async (kind) => {
    let complete!: () => void;
    const navigation = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const props = kind === 'marks' ? marksProps() : tocProps();
    if (kind === 'marks') {
      props.runtime.goToLocator = navigation as typeof props.runtime.goToLocator;
      renderToStaticMarkup(React.createElement(MarksDrawer, props as ComponentProps<typeof MarksDrawer>));
    } else {
      props.runtime.goToToc = navigation as typeof props.runtime.goToToc;
      renderToStaticMarkup(React.createElement(TocDrawer, props as ComponentProps<typeof TocDrawer>));
    }
    const press = buttons.get(kind === 'marks' ? 'reader.goToMark' : 'reader.goToToc')!;
    press();
    press();
    expect(navigation).toHaveBeenCalledTimes(1);
    complete();
    await vi.waitFor(() => expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
    if (kind === 'marks') expect((props as ComponentProps<typeof MarksDrawer>).onNavigated).toHaveBeenCalledOnce();
  });

  it.each(['marks', 'toc'] as const)('reopens %s and reports a failed jump after closing', async (kind) => {
    const navigation = vi.fn().mockRejectedValue(new Error('Missing target'));
    const props = kind === 'marks' ? marksProps() : tocProps();
    if (kind === 'marks') {
      props.runtime.goToLocator = navigation;
      renderToStaticMarkup(React.createElement(MarksDrawer, props as ComponentProps<typeof MarksDrawer>));
    } else {
      props.runtime.goToToc = navigation;
      renderToStaticMarkup(React.createElement(TocDrawer, props as ComponentProps<typeof TocDrawer>));
    }
    buttons.get(kind === 'marks' ? 'reader.goToMark' : 'reader.goToToc')!();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith({
      variant: 'danger', label: kind === 'marks' ? 'reader.markNavigationFailed' : 'reader.tocNavigationFailed',
    }));
    expect(navigation).toHaveBeenCalledOnce();
    expect(vi.mocked(props.onOpenChange)).not.toHaveBeenCalled();
    if (kind === 'marks') expect((props as ComponentProps<typeof MarksDrawer>).onNavigated).not.toHaveBeenCalled();
    // Failure releases the guard so the same target can be retried.
    buttons.get(kind === 'marks' ? 'reader.goToMark' : 'reader.goToToc')!();
    await vi.waitFor(() => expect(navigation).toHaveBeenCalledTimes(2));
  });

  it.each(['marks', 'toc'] as const)('ignores a normal %s dismissal with no requested jump', async (kind) => {
    const props = kind === 'marks' ? marksProps() : tocProps();
    if (kind === 'marks') {
      renderToStaticMarkup(React.createElement(MarksDrawer, props as ComponentProps<typeof MarksDrawer>));
    } else {
      renderToStaticMarkup(React.createElement(TocDrawer, props as ComponentProps<typeof TocDrawer>));
    }
    const navigation = kind === 'marks' ? props.runtime.goToLocator : props.runtime.goToToc;
    expect(navigation).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps bookmark deletion separate from a queued jump', async () => {
    const props = marksProps();
    renderToStaticMarkup(React.createElement(MarksDrawer, props));
    buttons.get('reader.goToMark')!();
    buttons.get('reader.removeBookmark')!();
    expect(props.onRemoveBookmark).not.toHaveBeenCalled();
    expect(props.runtime.goToLocator).toHaveBeenCalledOnce();
  });
});
