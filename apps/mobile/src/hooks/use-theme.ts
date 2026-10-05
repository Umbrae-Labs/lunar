import { useThemeColor } from 'heroui-native/hooks';
import { Platform } from 'react-native';

const THEME_COLOR_KEYS = [
  'foreground',
  'background',
  'surface',
  'surface-secondary',
  'muted',
  'accent',
  'accent-soft',
  'border',
] as const;

export function useTheme() {
  const [foreground, background, surface, surfaceSecondary, muted, accent, accentSoft, border] =
    useThemeColor(THEME_COLOR_KEYS);

  return {
    text: foreground,
    background,
    surface,
    backgroundElement: surfaceSecondary,
    textSecondary: muted,
    accent,
    accentSoft,
    border,
    navigationActive: accent,
  } as const;
}

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
