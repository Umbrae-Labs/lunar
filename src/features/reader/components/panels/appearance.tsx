import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useEffect, useState } from 'react';
import { BackHandler, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind, withUniwind } from 'uniwind';

import { READER_PAPER_COLORS, type ReaderPaperColor, useReaderStore } from '@/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { BrightnessSlider } from '../controls/brightness-slider';
import { READER_PAPER_PALETTES } from '../../domain/reader-paper-palettes';
import { getBarInset } from '../navigation/layout';

interface AppearanceProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
}

const SettingsScrollView = withUniwind(BottomSheetScrollView);

export function Appearance({ isOpen, onOpenChange }: AppearanceProps) {
  const { t } = useTranslation();
  const { theme } = useUniwind();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomInset = getBarInset(insets.bottom);
  const brightness = useReaderStore((state) => state.brightness);
  const setBrightness = useReaderStore((state) => state.setBrightness);
  const paperColor = useReaderStore((state) => state.paperColors[theme]);
  const setPaperColor = useReaderStore((state) => state.setPaperColor);
  const { textSecondary } = useTheme();
  const [settingsHeight, setSettingsHeight] = useState(320);
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpenChange(false);
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onOpenChange]);

  const availableHeight = Math.max(1, height - insets.top - bottomInset - 16);
  const sheetHeight = Math.min(settingsHeight + 24, availableHeight);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay style={{ bottom: bottomInset }} />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-overlay"
          bottomInset={bottomInset}
          contentContainerClassName="h-full flex-1 p-0"
          detached
          enableDynamicSizing={false}
          enableOverDrag={false}
          snapPoints={[sheetHeight]}>
          <SettingsScrollView
            className="flex-1"
            contentContainerClassName="gap-6 px-5 pb-5 pt-3"
            onContentSizeChange={(_width, contentHeight) => setSettingsHeight(Math.ceil(contentHeight))}
            showsVerticalScrollIndicator={false}>
            <View className="gap-1">
              <BottomSheet.Title className="text-xl text-foreground">{t('reader.appearance')}</BottomSheet.Title>
            </View>

            <View className="gap-2">
              <Text className="px-1 text-sm text-muted">{t('reader.brightness')}</Text>
              <View className="h-14 flex-row items-center rounded-2xl bg-surface px-2 dark:bg-surface-secondary">
                <SymbolView
                  name={{ ios: 'sun.min', android: 'brightness_low', web: 'brightness_low' }}
                  size={20}
                  tintColor={textSecondary}
                />
                <BrightnessSlider
                  accessibilityLabel={t('reader.adjustBrightness')}
                  value={brightness}
                  onChangeEnd={setBrightness}
                />
                <SymbolView
                  name={{ ios: 'sun.max', android: 'brightness_high', web: 'brightness_high' }}
                  size={20}
                  tintColor={textSecondary}
                />
              </View>
            </View>

            <View className="gap-3">
              <Text className="px-1 text-sm text-muted">{t('reader.paperColor')}</Text>
              <View className="flex-row gap-3">
                {READER_PAPER_COLORS.map((color) => (
                  <PaperColorButton
                    key={color}
                    backgroundColor={READER_PAPER_PALETTES[theme][color].backgroundColor}
                    isSelected={paperColor === color}
                    label={paperColorLabel(color, theme, t)}
                    onPress={() => setPaperColor(theme, color)}
                  />
                ))}
              </View>
            </View>
          </SettingsScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

interface PaperColorButtonProps {
  readonly backgroundColor: string;
  readonly isSelected: boolean;
  readonly label: string;
  readonly onPress: () => void;
}

function PaperColorButton({ backgroundColor, isSelected, label, onPress }: PaperColorButtonProps) {
  return (
    <Button
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      className={
        isSelected
          ? 'h-12 min-w-0 flex-1 rounded-xl border-2 border-navigation-active px-0'
          : 'h-12 min-w-0 flex-1 rounded-xl border-2 border-border px-0'
      }
      style={{ backgroundColor }}
      isIconOnly
      onPress={onPress}
      variant="ghost"
    />
  );
}

function paperColorLabel(
  color: ReaderPaperColor,
  theme: 'light' | 'dark',
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (color) {
    case 'default':
      return t(theme === 'dark' ? 'reader.paperColorBlack' : 'reader.paperColorWhite');
    case 'warm':
      return t(theme === 'dark' ? 'reader.paperColorBrown' : 'reader.paperColorCream');
    case 'green':
      return t('reader.paperColorGreen');
    case 'blue':
      return t('reader.paperColorBlue');
    case 'gray':
      return t('reader.paperColorGray');
  }
}
