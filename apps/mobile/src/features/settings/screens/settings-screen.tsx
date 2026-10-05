import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type LanguagePreference, useTranslation } from '@/i18n';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { type ApplicationThemeMode, useApplicationSettingsStore } from '@/stores';
import { LanguageSelectionSheet } from '../components/language-selection-sheet';
import { SettingRow } from '../components/setting-row';
import { SettingSection } from '../components/setting-section';
import { ThemeSelectionSheet } from '../components/theme-selection-sheet';

export function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useMarkInitialContentReady(true);
  const themeMode = useApplicationSettingsStore((state) => state.themeMode);
  const setThemeMode = useApplicationSettingsStore((state) => state.setThemeMode);
  const language = useApplicationSettingsStore((state) => state.language);
  const setLanguage = useApplicationSettingsStore((state) => state.setLanguage);
  const [isLanguageSelectionOpen, setIsLanguageSelectionOpen] = useState(false);
  const [isThemeSelectionOpen, setIsThemeSelectionOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setIsLanguageSelectionOpen(false);
        setIsThemeSelectionOpen(false);
      };
    }, []),
  );

  const handleLanguageChange = (nextLanguage: LanguagePreference) => {
    setLanguage(nextLanguage);
  };

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-1"
        style={{
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="grow px-4 pt-4 pb-32">
          <View className="w-full max-w-[800px] self-center">
            <SettingSection title={t('settings.appearance')}>
              <SettingRow
                variant="action"
                title={t('settings.theme')}
                value={themeLabel(themeMode, t)}
                accessibilityHint={t('settings.themeHint')}
                onPress={() => setIsThemeSelectionOpen(true)}
              />
              <SettingRow
                variant="action"
                title={t('settings.language')}
                value={languageLabel(language, t)}
                accessibilityHint={t('settings.languageHint')}
                onPress={() => setIsLanguageSelectionOpen(true)}
              />
            </SettingSection>
            <View className="mt-8">
              <SettingSection title={t('settings.readingSettings')} onPress={() => router.push('/settings/reading')} />
            </View>
            <View className="mt-8">
              <SettingSection title={t('settings.about')} onPress={() => router.push('/settings/about')} />
            </View>
          </View>
        </ScrollView>
      </View>

      <LanguageSelectionSheet
        isOpen={isLanguageSelectionOpen}
        language={language}
        onLanguageChange={handleLanguageChange}
        onOpenChange={setIsLanguageSelectionOpen}
      />
      <ThemeSelectionSheet
        isOpen={isThemeSelectionOpen}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
        onOpenChange={setIsThemeSelectionOpen}
      />
    </View>
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
