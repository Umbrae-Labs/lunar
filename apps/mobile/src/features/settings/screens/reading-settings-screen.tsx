import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useCallback, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontSheet } from '@/features/reader';
import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';
import type { ReaderFontRole } from '@/reader';
import { useApplicationSettingsStore, useFontStore, useReaderStore } from '@/stores';
import { ReadingFontsSection } from '../components/reading-fonts-section';
import { SettingRow } from '../components/setting-row';
import { SettingSection } from '../components/setting-section';

const FONT_ROLES: readonly ReaderFontRole[] = ['body', 'chrome'];

export function ReadingSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor('foreground');
  useMarkInitialContentReady(true);
  const resumeReadingOnLaunch = useApplicationSettingsStore((state) => state.resumeReadingOnLaunch);
  const setResumeReadingOnLaunch = useApplicationSettingsStore((state) => state.setResumeReadingOnLaunch);
  const keepScreenAwake = useReaderStore((state) => state.keepScreenAwake);
  const setKeepScreenAwake = useReaderStore((state) => state.setKeepScreenAwake);
  const showSystemStatusBar = useReaderStore((state) => state.showSystemStatusBar);
  const setShowSystemStatusBar = useReaderStore((state) => state.setShowSystemStatusBar);
  const volumeKeysTurnPages = useReaderStore((state) => state.volumeKeysTurnPages);
  const setVolumeKeysTurnPages = useReaderStore((state) => state.setVolumeKeysTurnPages);
  const selectedFonts = useReaderStore((state) => state.typography.fonts);
  const fonts = useFontStore((state) => state.fonts);
  const [pickerRole, setPickerRole] = useState<ReaderFontRole>('body');
  const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);

  useFocusEffect(
    useCallback(
      () => () => {
        Keyboard.dismiss();
        setIsFontPickerOpen(false);
      },
      [],
    ),
  );

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}>
      <View className="w-full max-w-[800px] flex-row items-center gap-2 self-center px-4 py-2">
        <Button
          isIconOnly
          accessibilityLabel={t('settings.backToSettings')}
          className="size-12 rounded-full"
          variant="ghost"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)/settings');
          }}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
            tintColor={foreground}
          />
        </Button>
        <Text accessibilityRole="header" className="min-w-0 flex-1 text-2xl font-semibold text-foreground">
          {t('settings.readingSettings')}
        </Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="grow px-4 pt-4 pb-8">
        <View className="w-full max-w-[800px] gap-8 self-center">
          <SettingSection title={t('settings.reading')}>
            <SettingRow
              variant="switch"
              title={t('settings.resumeReadingOnLaunch')}
              description={t('settings.resumeReadingOnLaunchDescription')}
              accessibilityHint={t('settings.resumeReadingOnLaunchHint')}
              isSelected={resumeReadingOnLaunch}
              onSelectedChange={setResumeReadingOnLaunch}
            />
            <SettingRow
              variant="switch"
              title={t('settings.keepScreenAwake')}
              description={t('settings.keepScreenAwakeDescription')}
              isSelected={keepScreenAwake}
              onSelectedChange={setKeepScreenAwake}
            />
            <SettingRow
              variant="switch"
              title={t('settings.showSystemStatusBar')}
              description={t('settings.showSystemStatusBarDescription')}
              isSelected={showSystemStatusBar}
              onSelectedChange={setShowSystemStatusBar}
            />
            <SettingRow
              variant="switch"
              title={t('settings.volumeKeysTurnPages')}
              description={t('settings.volumeKeysTurnPagesDescription')}
              isSelected={volumeKeysTurnPages}
              onSelectedChange={setVolumeKeysTurnPages}
            />
          </SettingSection>
          <SettingSection title={t('settings.readingFonts')}>
            {FONT_ROLES.map((role) => {
              const selected = selectedFonts[role];
              const label =
                selected.source === 'builtin'
                  ? t('reader.builtinFont')
                  : selected.source === 'imported'
                    ? (fonts.find((font) => font.id === selected.importedFontId)?.family ?? selected.family)
                    : selected.family;
              return (
                <SettingRow
                  key={role}
                  variant="action"
                  title={t(role === 'body' ? 'reader.bodyFont' : 'reader.uiFont')}
                  description={label}
                  accessibilityHint={t('reader.chooseFont')}
                  onPress={() => {
                    setPickerRole(role);
                    setIsFontPickerOpen(true);
                  }}
                />
              );
            })}
          </SettingSection>
          <ReadingFontsSection />
        </View>
      </ScrollView>
      <FontSheet role={pickerRole} isOpen={isFontPickerOpen} onOpenChange={setIsFontPickerOpen} />
    </View>
  );
}
