import { SelectSheet } from '@/components/ui/select';
import { type LanguagePreference, useTranslation } from '@/i18n';

type LanguageSelectionSheetProps = {
  readonly isOpen: boolean;
  readonly language: LanguagePreference;
  readonly onLanguageChange: (language: LanguagePreference) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
};

const LANGUAGE_OPTIONS: readonly LanguagePreference[] = ['system', 'zh-CN', 'en'];

export function LanguageSelectionSheet({
  isOpen,
  language,
  onLanguageChange,
  onOpenChange,
}: LanguageSelectionSheetProps) {
  const { t } = useTranslation();

  return (
    <SelectSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onValueChange={onLanguageChange}
      options={LANGUAGE_OPTIONS.map((option) => ({ value: option, label: languageLabel(option, t) }))}
      title={t('settings.languageSelection')}
      value={language}
    />
  );
}

function languageLabel(language: LanguagePreference, t: ReturnType<typeof useTranslation>['t']): string {
  switch (language) {
    case 'zh-CN':
      return t('settings.chinese');
    case 'en':
      return t('settings.english');
    default:
      return t('settings.systemLanguage');
  }
}
