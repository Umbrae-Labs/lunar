import { SelectSheet } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { type ApplicationThemeMode } from '@/stores';

type ThemeSelectionSheetProps = {
  readonly isOpen: boolean;
  readonly themeMode: ApplicationThemeMode;
  readonly onThemeModeChange: (themeMode: ApplicationThemeMode) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
};

const THEME_OPTIONS: readonly ApplicationThemeMode[] = ['system', 'light', 'dark'];

export function ThemeSelectionSheet({ isOpen, themeMode, onThemeModeChange, onOpenChange }: ThemeSelectionSheetProps) {
  const { t } = useTranslation();

  return (
    <SelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onValueChange={onThemeModeChange}
      options={THEME_OPTIONS.map((option) => ({ value: option, label: themeLabel(option, t) }))}
      title={t('settings.themeSelection')}
      value={themeMode}
    />
  );
}

function themeLabel(themeMode: ApplicationThemeMode, t: ReturnType<typeof useTranslation>['t']): string {
  switch (themeMode) {
    case 'dark':
      return t('settings.dark');
    case 'light':
      return t('settings.light');
    default:
      return t('settings.systemTheme');
  }
}
