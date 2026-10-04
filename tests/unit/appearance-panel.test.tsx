import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Appearance } from '../../src/features/reader/components/panels/appearance';
import { READER_PAPER_PALETTES } from '../../src/features/reader/domain/reader-paper-palettes';
import { READER_PAPER_COLORS } from '../../src/stores/reader-appearance-preferences';
import type { ReaderAppearanceMode, ReaderPaperColor } from '../../src/stores/reader-appearance-preferences';

const ui = vi.hoisted(() => ({
  theme: 'light' as ReaderAppearanceMode,
  preferences: { light: 'green', dark: 'blue' } as Record<ReaderAppearanceMode, ReaderPaperColor>,
  buttons: [] as { label: string; selected: boolean; background: string; press: () => void }[],
}));
vi.mock('@/stores', async () => {
  const { READER_PAPER_COLORS: colors } = await import('../../src/stores/reader-appearance-preferences');
  return {
    READER_PAPER_COLORS: colors,
    useReaderStore: (select: (state: unknown) => unknown) =>
      select({
        paperColors: ui.preferences,
        brightness: 1,
        setBrightness: vi.fn(),
        setPaperColor: (mode: ReaderAppearanceMode, color: ReaderPaperColor) => {
          ui.preferences[mode] = color;
        },
      }),
  };
});
vi.mock('uniwind', () => ({ useUniwind: () => ({ theme: ui.theme }), withUniwind: (component: unknown) => component }));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useWindowDimensions: () => ({ height: 800 }),
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('heroui-native/bottom-sheet', () => {
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    BottomSheet: Object.assign(Container, {
      Portal: Container,
      Content: Container,
      Title: Container,
      Overlay: () => null,
    }),
  };
});
vi.mock('heroui-native/button', () => ({
  Button: (props: {
    accessibilityLabel: string;
    accessibilityState: { selected: boolean };
    style: { backgroundColor: string };
    onPress: () => void;
  }) => {
    ui.buttons.push({
      label: props.accessibilityLabel,
      selected: props.accessibilityState.selected,
      background: props.style.backgroundColor,
      press: props.onPress,
    });
    return <button aria-label={props.accessibilityLabel} />;
  },
}));
vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ textSecondary: '#888888' }) }));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../src/features/reader/components/controls/brightness-slider', () => ({
  BrightnessSlider: () => null,
}));
vi.mock('../../src/features/reader/components/navigation/layout', () => ({ getBarInset: () => 48 }));

beforeEach(() => {
  vi.stubGlobal('React', React);
  ui.theme = 'light';
  ui.preferences = { light: 'green', dark: 'blue' };
  ui.buttons = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('global reader appearance', () => {
  it.each(['light', 'dark'] as const)('shows five %s swatches matching the content palette', (theme) => {
    ui.theme = theme;
    renderToStaticMarkup(<Appearance isOpen onOpenChange={vi.fn()} />);
    expect(ui.buttons).toHaveLength(5);
    expect(ui.buttons.map((button) => button.background)).toEqual(
      READER_PAPER_COLORS.map((id) => READER_PAPER_PALETTES[theme][id].backgroundColor),
    );
    expect(ui.buttons.filter((button) => button.selected)).toHaveLength(1);
    expect(ui.buttons.find((button) => button.selected)?.background).toBe(
      READER_PAPER_PALETTES[theme][ui.preferences[theme]].backgroundColor,
    );
    ui.buttons[1].press();
    expect(ui.theme).toBe(theme);
    expect(ui.preferences[theme]).toBe('warm');
    expect(ui.preferences[theme === 'dark' ? 'light' : 'dark']).toBe(theme === 'dark' ? 'green' : 'blue');
  });

  it('restores each selection when the global theme changes', () => {
    for (const theme of ['light', 'dark', 'light'] as const) {
      ui.theme = theme;
      ui.buttons = [];
      renderToStaticMarkup(<Appearance isOpen onOpenChange={vi.fn()} />);
      const selected = ui.buttons.find((button) => button.selected)!;
      expect(selected.background).toBe(READER_PAPER_PALETTES[theme][ui.preferences[theme]].backgroundColor);
    }
  });

  it.each(['light', 'dark'] as const)('keeps all %s palettes readable and within their brightness range', (theme) => {
    const palettes = Object.values(READER_PAPER_PALETTES[theme]);
    expect(new Set(palettes.map((palette) => palette.backgroundColor)).size).toBe(5);
    for (const palette of palettes) {
      const background = luminance(palette.backgroundColor);
      const foreground = luminance(palette.foregroundColor);
      expect(background).toBe(theme === 'light' ? Math.max(background, 0.7) : Math.min(background, 0.05));
      expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThan(7);
    }
  });
});

function luminance(hex: string): number {
  const rgb = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
