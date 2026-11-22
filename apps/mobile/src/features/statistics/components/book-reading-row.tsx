import { Image as ExpoImage } from 'expo-image';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { Text, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { useTranslation } from '@/i18n';
import { durationParts, type StatisticsBook } from '../domain/statistics';
const Image = withUniwind(ExpoImage);

export function BookReadingRow({
  book,
  onPress,
  showProgress = true,
}: {
  book: StatisticsBook;
  onPress: () => void;
  showProgress?: boolean;
}) {
  const { t } = useTranslation();
  const parts = durationParts(book.milliseconds);
  return (
    <PressableFeedback
      accessibilityRole="button"
      accessibilityLabel={t('statistics.openBook', { title: book.title })}
      onPress={onPress}
      animation={{ scale: { value: 0.99, timingConfig: { duration: 160 } } }}
      className="flex-row gap-4 overflow-hidden rounded-3xl bg-surface p-4 active:bg-surface-secondary dark:active:bg-surface-tertiary">
      {book.coverUri ? (
        <Image accessible={false} source={book.coverUri} contentFit="cover" className="h-28 w-20 rounded-lg" />
      ) : (
        <View className="h-28 w-20 items-center justify-center rounded-lg bg-default">
          <Text className="text-2xl text-muted">{book.title.slice(0, 1)}</Text>
        </View>
      )}
      <View className="min-w-0 flex-1 justify-between gap-3 py-1">
        <View className="gap-1">
          <Text numberOfLines={2} className="text-base font-semibold text-foreground">
            {book.title}
          </Text>
          {book.author ? (
            <Text numberOfLines={1} className="text-sm text-muted">
              {book.author}
            </Text>
          ) : null}
        </View>
        <View className="gap-2">
          <View className="flex-row flex-wrap justify-between gap-2">
            <Text className="text-sm text-foreground">
              {parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts)}
            </Text>
            {showProgress ? (
              <Text className="text-sm text-navigation-active">
                {book.progress >= 1 ? t('statistics.finished') : `${Math.floor(book.progress * 100)}%`}
              </Text>
            ) : null}
          </View>
          {showProgress ? (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.floor(book.progress * 100) }}
              className="h-1 overflow-hidden rounded-full bg-default">
              <View className="h-full rounded-full bg-navigation-active" style={{ width: `${book.progress * 100}%` }} />
            </View>
          ) : null}
        </View>
      </View>
    </PressableFeedback>
  );
}
