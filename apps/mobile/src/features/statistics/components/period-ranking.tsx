import { Image as ExpoImage } from 'expo-image';
import { Button } from 'heroui-native/button';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { withUniwind } from 'uniwind';
import { useTranslation } from '@/i18n';
import { durationParts, type selectPeriod } from '../domain/statistics';
const Image = withUniwind(ExpoImage);
const COLLAPSED_COUNT = 3;

export function PeriodRanking({
  period,
  onOpenBook,
}: {
  period: ReturnType<typeof selectPeriod>;
  onOpenBook: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? period.ranking : period.ranking.slice(0, COLLAPSED_COUNT);
  const duration = (milliseconds: number) => {
    const parts = durationParts(milliseconds);
    return parts.hours ? t('statistics.hours', parts) : t('statistics.minutes', parts);
  };
  return (
    <View className="gap-4 rounded-3xl bg-surface p-5">
      <View className="flex-row flex-wrap items-baseline justify-between gap-2">
        <Text className="text-base font-semibold text-foreground">{t('statistics.ranking')}</Text>
        <Text className="text-xs text-muted">{t('statistics.count', { count: period.books.length })}</Text>
      </View>
      {!period.books.length ? (
        <Text className="text-sm text-muted">{t('statistics.periodEmpty')}</Text>
      ) : (
        <>
          {shown.map((book, index) => (
            <PressableFeedback
              key={book.id}
              className="flex-row items-center gap-3 rounded-xl py-2 active:bg-surface-secondary dark:active:bg-surface-tertiary"
              animation={{ scale: { value: 0.99 } }}
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}. ${book.title}, ${duration(book.milliseconds)}, ${(book.share * 100).toFixed(1)}%`}
              onPress={() => onOpenBook(book.id)}>
              <Text className="w-5 text-center text-xs text-muted">{index + 1}</Text>
              {book.coverUri ? (
                <Image source={book.coverUri} className="h-14 w-10 rounded-md" contentFit="cover" accessible={false} />
              ) : (
                <View className="h-14 w-10 items-center justify-center rounded-md bg-default">
                  <Text className="text-muted">{book.title.slice(0, 1)}</Text>
                </View>
              )}
              <View className="min-w-0 flex-1 gap-2">
                <Text numberOfLines={2} className="text-sm font-medium text-foreground">
                  {book.title}
                </Text>
                <View className="flex-row flex-wrap justify-between gap-1">
                  <Text className="text-xs text-muted">{duration(book.milliseconds)}</Text>
                  <Text className="text-xs text-navigation-active">{(book.share * 100).toFixed(1)}%</Text>
                </View>
                <View className="h-1 overflow-hidden rounded-full bg-default">
                  <View
                    className="h-full rounded-full bg-navigation-active"
                    style={{ width: `${book.share * 100}%` }}
                  />
                </View>
              </View>
            </PressableFeedback>
          ))}
          {period.ranking.length > COLLAPSED_COUNT ? (
            <Button variant="ghost" size="sm" onPress={() => setExpanded((value) => !value)}>
              {expanded
                ? t('statistics.rankingCollapse')
                : t('statistics.rankingExpand', { count: period.ranking.length - COLLAPSED_COUNT })}
            </Button>
          ) : null}
        </>
      )}
    </View>
  );
}
