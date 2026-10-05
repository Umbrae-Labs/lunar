import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { useToast } from 'heroui-native/toast';
import { ScrollView, Text, View, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useUniwind, withUniwind } from 'uniwind';

import { useMarkInitialContentReady } from '@/hooks/use-mark-initial-content-ready';
import { useTranslation } from '@/i18n';

import { getAppVersionLabel } from '../infrastructure/app-version';

const APP_ICON = require('../../../../assets/images/icon.png');
const WORDMARK_BLACK = require('../../../../assets/images/wordmark-black.png');
const WORDMARK_WHITE = require('../../../../assets/images/wordmark-white.png');
const Image = withUniwind(ExpoImage);

export function AboutScreen() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor('foreground');
  const { theme } = useUniwind();
  const version = getAppVersionLabel();
  const year = new Date().getFullYear();
  useMarkInitialContentReady(true);

  const handleOpenRepository = async () => {
    try {
      await Linking.openURL('https://github.com/Umbrae-Labs/lunar');
    } catch {
      toast.show({
        variant: 'danger',
        label: t('settings.openGitHubFailed'),
        description: t('settings.openGitHubFailedDescription'),
      });
    }
  };

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
          {t('settings.about')}
        </Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="grow items-center justify-between px-4 pt-12 pb-6">
        <View className="w-full max-w-[800px] items-center">
          <View className="size-36 overflow-hidden rounded-3xl bg-surface">
            <Image
              accessibilityLabel="Lunar"
              className="absolute inset-0 h-full w-full"
              contentFit="cover"
              source={APP_ICON}
            />
          </View>
          <Image
            accessibilityLabel="Lunar"
            className="mt-7 h-9 w-32"
            contentFit="contain"
            source={theme === 'dark' ? WORDMARK_WHITE : WORDMARK_BLACK}
          />
          {version ? <Text className="mt-3 text-base text-muted">{version}</Text> : null}
        </View>
        <View className="items-center gap-2 pt-12">
          <Button
            isIconOnly
            accessibilityRole="link"
            accessibilityLabel={t('settings.openGitHub')}
            accessibilityHint={t('settings.openGitHubHint')}
            className="size-12 rounded-full"
            variant="ghost"
            onPress={() => void handleOpenRepository()}>
            <Svg width={24} height={24} viewBox="0 0 16 16" accessible={false}>
              <Path
                fill={foreground}
                d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"
              />
            </Svg>
          </Button>
          <Text className="text-center text-sm text-muted">© {year} Umbrae Labs</Text>
        </View>
      </ScrollView>
    </View>
  );
}
