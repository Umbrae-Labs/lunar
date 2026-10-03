import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopedTheme, useUniwind } from 'uniwind';
import { Portal } from 'heroui-native/portal';

import { ThemedPortal } from '../../src/components/ui/themed-portal';
import { ThemedBottomSheetPortal } from '../../src/components/ui/themed-bottom-sheet-portal';
import { ConfirmModal } from '../../src/components/ui/confirm-modal';
import { IconTabBar } from '../../src/features/reader/components/icon-tab-bar';

const host = vi.hoisted(() => ({
  children: undefined as ReactNode,
  props: {} as Record<string, unknown>,
}));

vi.mock('uniwind', async () => {
  const { createContext, useContext } = await import('react');
  const ThemeContext = createContext('light');
  return {
    ScopedTheme: ({ theme, children }: { theme: string; children: ReactNode }) =>
      React.createElement(ThemeContext.Provider, { value: theme }, children),
    useUniwind: () => ({ theme: useContext(ThemeContext) }),
    useCSSVariable: () => 'blue',
  };
});

// HeroUI stores the children and renders them later beneath a separate host.
// Returning children here would incorrectly preserve the publisher's context.
vi.mock('heroui-native/portal', () => ({
  Portal: ({ children, ...props }: { children: ReactNode }) => {
    host.children = children;
    host.props = props;
    return null;
  },
}));
vi.mock('heroui-native/bottom-sheet', async () => {
  const { Portal: PortalMock } = await import('heroui-native/portal');
  return { BottomSheet: { Portal: PortalMock } };
});
vi.mock('heroui-native/dialog', async () => {
  const { Portal: PortalMock } = await import('heroui-native/portal');
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Dialog: Object.assign(Container, {
      Portal: PortalMock,
      Overlay: () => null,
      Content: Container,
      Title: Container,
      Description: Container,
    }),
  };
});
vi.mock('react-native', () => ({
  View: ({ className, children }: { className?: string; children: ReactNode }) => {
    const { theme } = useUniwind();
    return (
      <div data-theme={theme} className={className}>
        {children}
      </div>
    );
  },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('heroui-native/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
vi.mock('expo-symbols', () => ({
  SymbolView: ({ tintColor }: { tintColor: string }) => <i data-color={tintColor} />,
}));
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ textSecondary: useUniwind().theme === 'light' ? 'dark-gray' : 'light-gray' }),
}));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  host.children = undefined;
  host.props = {};
});
afterEach(() => vi.unstubAllGlobals());

function ThemeProbe() {
  return <span>{useUniwind().theme}</span>;
}

function publish(content: ReactNode, readerTheme: 'light' | 'dark') {
  renderToStaticMarkup(<ScopedTheme theme={readerTheme}>{content}</ScopedTheme>);
}

function renderHost(globalTheme: 'light' | 'dark') {
  return renderToStaticMarkup(<ScopedTheme theme={globalTheme}>{host.children}</ScopedTheme>);
}

describe('portal theme preservation', () => {
  it('models the context loss of an ordinary HeroUI portal', () => {
    publish(
      <Portal name="plain">
        <ThemeProbe />
      </Portal>,
      'light',
    );
    expect(renderHost('dark')).toBe('<span>dark</span>');
  });

  it.each(['light', 'dark'] as const)('keeps reader %s colors in an oppositely themed host', (readerTheme) => {
    const globalTheme = readerTheme === 'light' ? 'dark' : 'light';
    publish(
      <ThemedPortal name="reader">
        <ThemeProbe />
      </ThemedPortal>,
      readerTheme,
    );
    expect(renderHost(globalTheme)).toBe(`<span>${readerTheme}</span>`);

    publish(
      <ThemedBottomSheetPortal hostName="custom" disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <ThemeProbe />
      </ThemedBottomSheetPortal>,
      readerTheme,
    );
    expect(renderHost(globalTheme)).toBe(`<span>${readerTheme}</span>`);
    expect(host.props).toMatchObject({
      hostName: 'custom',
      disableFullWindowOverlay: true,
      unstable_accessibilityContainerViewIsModal: true,
    });
  });

  it('updates a portal theme when the reader changes paper colors', () => {
    for (const theme of ['light', 'dark', 'light'] as const) {
      publish(
        <ThemedBottomSheetPortal>
          <ThemeProbe />
        </ThemedBottomSheetPortal>,
        theme,
      );
      expect(renderHost('dark')).toBe(`<span>${theme}</span>`);
    }
  });

  it.each(['light', 'dark'] as const)('renders tab surfaces and icons together in reader %s mode', (readerTheme) => {
    publish(
      <IconTabBar
        items={[{ key: 'appearance', accessibilityLabel: 'Appearance', name: 'sun.max' }]}
        onSelect={vi.fn()}
      />,
      readerTheme,
    );
    const markup = renderHost(readerTheme === 'light' ? 'dark' : 'light');
    expect(markup).toContain(`data-theme="${readerTheme}"`);
    expect(markup).toContain('bg-surface');
    expect(markup).toContain(`data-color="${readerTheme === 'light' ? 'dark-gray' : 'light-gray'}"`);
  });

  it('preserves the reader theme through a second portal for confirmation', () => {
    publish(
      <ThemedBottomSheetPortal>
        <ConfirmModal
          isOpen
          title="Delete"
          description={<ThemeProbe />}
          confirmLabel="Delete"
          onConfirm={vi.fn()}
          onOpenChange={vi.fn()}
          portalHostName="confirmation"
        />
      </ThemedBottomSheetPortal>,
      'light',
    );
    renderHost('dark');
    expect(host.props).toMatchObject({ hostName: 'confirmation' });
    expect(renderHost('dark')).toContain('<span>light</span>');
  });
});
