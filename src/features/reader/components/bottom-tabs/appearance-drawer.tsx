import { ThemedBottomSheetPortal } from '@/components/ui/themed-bottom-sheet-portal';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SymbolView } from 'expo-symbols';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useEffect, useState } from 'react';
import { BackHandler, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { READER_PAPER_COLORS, type ReaderPaperColor, useReaderStore } from '@/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { ReaderBrightnessSlider } from '../reader-brightness-slider';
import { getReaderBottomTabBarInset } from './constants';

interface AppearanceDrawerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (value: boolean) => void;
}

const PAPER_SWATCHES: Readonly<Record<ReaderPaperColor, string>> = {
  auto: '#E5E7EB',
  white: '#FFFFFF',
  cream: '#F4F0DF',
  green: '#DDEEDB',
  dark: '#202124',
};

const SettingsScrollView = withUniwind(BottomSheetScrollView);

export function AppearanceDrawer({ isOpen, onOpenChange }: AppearanceDrawerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomInset = getReaderBottomTabBarInset(insets.bottom);
  const brightness = useReaderStore((state) => state.brightness);
  const setBrightness = useReaderStore((state) => state.setBrightness);
  const paperColor = useReaderStore((state) => state.paperColor);
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
      <ThemedBottomSheetPortal disableFullWindowOverlay unstable_accessibilityContainerViewIsModal>
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
                <ReaderBrightnessSlider
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
                    color={color}
                    isSelected={paperColor === color}
                    label={paperColorLabel(color, t)}
                    onPress={() => setPaperColor(color)}
                  />
                ))}
              </View>
            </View>
          </SettingsScrollView>
        </BottomSheet.Content>
      </ThemedBottomSheetPortal>
    </BottomSheet>
  );
}

interface PaperColorButtonProps {
  readonly color: ReaderPaperColor;
  readonly isSelected: boolean;
  readonly label: string;
  readonly onPress: () => void;
}

function PaperColorButton({ color, isSelected, label, onPress }: PaperColorButtonProps) {
  return (
    <Button
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      className={
        isSelected
          ? 'h-14 min-w-0 flex-1 rounded-2xl border-2 border-navigation-active px-0'
          : 'h-14 min-w-0 flex-1 rounded-2xl border-2 border-transparent px-0'
      }
      isIconOnly
      onPress={onPress}
      variant="ghost">
      <View className="size-11 rounded-full" style={{ backgroundColor: PAPER_SWATCHES[color] }} />
    </Button>
  );
}

function paperColorLabel(color: ReaderPaperColor, t: ReturnType<typeof useTranslation>['t']): string {
  switch (color) {
    case 'auto':
      return t('reader.paperColorAuto');
    case 'white':
      return t('reader.paperColorWhite');
    case 'cream':
      return t('reader.paperColorCream');
    case 'green':
      return t('reader.paperColorGreen');
    case 'dark':
      return t('reader.paperColorDark');
  }
}
