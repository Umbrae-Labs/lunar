import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useEffect } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTranslation } from '@/i18n';
import type { StatisticsBook } from '../domain/statistics';
import { BookReadingRow } from './book-reading-row';
const DayScrollView = withUniwind(BottomSheetScrollView);
const daySnapPoints = ['60%', '85%'];

export function DailyReadingSheet({
  date,
  isOpen = Boolean(date),
  books,
  onClose,
  onOpenBook,
}: {
  date?: string;
  isOpen?: boolean;
  books: readonly StatisticsBook[];
  onClose: () => void;
  onOpenBook: (id: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onClose]);
  const calendarDate = date ? new Date(`${date}T00:00:00Z`) : undefined;
  const title = calendarDate
    ? t('statistics.fullDate', {
        year: calendarDate.getUTCFullYear(),
        month: t('statistics.monthsLong').split(',')[calendarDate.getUTCMonth()],
        day: calendarDate.getUTCDate(),
        weekday: t('statistics.weekdaysLong').split(',')[calendarDate.getUTCDay()],
      })
    : '';
  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl bg-background dark:bg-surface"
          contentContainerClassName="h-full px-5"
          snapPoints={daySnapPoints}
          enableDynamicSizing={false}
          enableOverDrag={false}>
          <View className="gap-3 pb-4">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1 gap-1">
                <BottomSheet.Title accessibilityLabel={title} className="text-xl font-semibold text-foreground">
                  {calendarDate
                    ? t('statistics.dateTitle', {
                        year: calendarDate.getUTCFullYear(),
                        month: t('statistics.monthsLong').split(',')[calendarDate.getUTCMonth()],
                        day: calendarDate.getUTCDate(),
                      })
                    : ''}
                </BottomSheet.Title>
                <Text className="text-xs text-muted">
                  {calendarDate ? t('statistics.weekdaysLong').split(',')[calendarDate.getUTCDay()] : ''}
                </Text>
              </View>
              <Button variant="ghost" size="sm" onPress={onClose} accessibilityLabel={t('action.close')}>
                {t('action.close')}
              </Button>
            </View>
          </View>
          <DayScrollView
            contentContainerClassName="gap-3"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
            {books.length ? (
              books.map((book) => (
                <BookReadingRow
                  key={book.id}
                  book={book}
                  showProgress={false}
                  onPress={() => {
                    onClose();
                    onOpenBook(book.id);
                  }}
                />
              ))
            ) : (
              <View className="rounded-3xl bg-surface p-6 dark:bg-surface-secondary">
                <Text className="text-sm text-muted">{t('statistics.dayEmpty')}</Text>
              </View>
            )}
          </DayScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
