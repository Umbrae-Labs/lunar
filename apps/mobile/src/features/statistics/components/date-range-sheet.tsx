import { BottomSheetFooter, BottomSheetScrollView, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { PressableFeedback } from 'heroui-native/pressable-feedback';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { useTranslation } from '@/i18n';
import { shiftDate, type DateRange } from '../domain/statistics';
const CalendarScroll = withUniwind(BottomSheetScrollView);
const calendarSnapPoints = ['90%'];

export function DateRangeSheet({
  range,
  today,
  isOpen,
  onClose,
  onApply,
}: {
  range: DateRange;
  today: string;
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: DateRange) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(range);
  const [field, setField] = useState<'start' | 'end'>('start');
  const [month, setMonth] = useState(range.start.slice(0, 7));
  const [wasOpen, setWasOpen] = useState(isOpen);
  // A closed sheet stays mounted in its portal; its calendar is built only while it is shown.
  const [rendered, setRendered] = useState(isOpen);
  // Reset unapplied edits before rendering a newly opened sheet, retaining close animations.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft(range);
      setField('start');
      setMonth(range.start.slice(0, 7));
      setRendered(true);
    }
  }
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [isOpen, onClose]);
  const move = (months: number) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + months);
    setMonth(date.toISOString().slice(0, 7));
  };
  const first = `${month}-01`;
  const rows = Math.ceil(
    (new Date(`${first}T00:00:00Z`).getUTCDay() +
      new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()) /
      7,
  );
  const gridStart = shiftDate(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const weekdays = t('statistics.weekdaysShort').split(',');
  const monthName = t('statistics.monthsLong').split(',')[Number(month.slice(5)) - 1];
  const valid = draft.start <= draft.end && draft.end <= today;
  const footer = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={insets.bottom}>
        <View className="gap-2 bg-background px-4 pb-4 pt-3 dark:bg-surface">
          {!valid ? (
            <Text accessibilityRole="alert" className="text-sm text-danger">
              {t('statistics.invalidRange')}
            </Text>
          ) : null}
          <Button isDisabled={!valid} onPress={() => onApply(draft)}>
            {t('statistics.applyRange')}
          </Button>
        </View>
      </BottomSheetFooter>
    ),
    [draft, insets.bottom, onApply, t, valid],
  );
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
          contentContainerClassName="h-full px-4"
          snapPoints={calendarSnapPoints}
          enableDynamicSizing={false}
          enableOverDrag={false}
          footerComponent={footer}
          onChange={(index: number) => {
            if (index === -1 && !isOpen) setRendered(false);
          }}>
          {rendered ? (
            <CalendarScroll
              enableFooterMarginAdjustment
              contentContainerClassName="gap-4"
              contentContainerStyle={{ paddingBottom: 16 }}>
              <View className="flex-row items-center justify-between gap-2">
                <BottomSheet.Title className="min-w-0 flex-1 text-xl font-semibold text-foreground">
                  {t('statistics.customRange')}
                </BottomSheet.Title>
                <Button size="sm" variant="ghost" onPress={onClose}>
                  {t('action.cancel')}
                </Button>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {(['start', 'end'] as const).map((part) => (
                  <PressableFeedback
                    key={part}
                    accessibilityRole="button"
                    accessibilityState={{ selected: field === part }}
                    accessibilityLabel={t(`statistics.${part}`)}
                    className={`min-w-[120px] flex-1 gap-1 rounded-2xl p-3 ${field === part ? 'bg-navigation-active/10' : 'bg-surface dark:bg-surface-secondary'}`}
                    onPress={() => {
                      setField(part);
                      setMonth(draft[part].slice(0, 7));
                    }}>
                    <Text className="text-xs text-muted">{t(`statistics.${part}`)}</Text>
                    <Text
                      className={
                        field === part ? 'text-sm font-semibold text-navigation-active' : 'text-sm text-foreground'
                      }>
                      {draft[part]}
                    </Text>
                  </PressableFeedback>
                ))}
              </View>
              <View className="gap-2 rounded-3xl bg-surface p-2 dark:bg-surface-secondary">
                <View className="flex-row items-center justify-between">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    accessibilityLabel={t('statistics.previousMonth')}
                    onPress={() => move(-1)}>
                    ‹
                  </Button>
                  <Text className="min-w-0 flex-1 text-center text-sm font-semibold text-foreground">
                    {month.slice(0, 4)} · {monthName}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    accessibilityLabel={t('statistics.nextMonth')}
                    isDisabled={month >= today.slice(0, 7)}
                    onPress={() => move(1)}>
                    ›
                  </Button>
                </View>
                <View className="flex-row">
                  {weekdays.map((day) => (
                    <Text key={day} className="flex-1 py-2 text-center text-[10px] text-muted">
                      {day}
                    </Text>
                  ))}
                </View>
                {Array.from({ length: rows }, (_, week) => (
                  <View key={week} className="flex-row">
                    {Array.from({ length: 7 }, (_, weekday) => {
                      const date = shiftDate(gridStart, week * 7 + weekday);
                      const shown = date.slice(0, 7) === month;
                      const edge = date === draft.start || date === draft.end;
                      const inside = valid && date > draft.start && date < draft.end;
                      return (
                        <PressableFeedback
                          key={date}
                          accessibilityRole="button"
                          accessibilityLabel={date}
                          accessibilityState={{ selected: edge, disabled: !shown || date > today }}
                          isDisabled={!shown || date > today}
                          className={`min-h-11 min-w-0 flex-1 items-center justify-center rounded-lg py-2 ${edge ? 'bg-navigation-active/15' : inside ? 'bg-default' : ''}`}
                          onPress={() => {
                            setDraft((previous) => ({ ...previous, [field]: date }));
                            if (field === 'start') setField('end');
                          }}>
                          <Text
                            className={`${edge ? 'font-semibold text-navigation-active' : 'text-foreground'} text-sm ${!shown ? 'opacity-0' : date > today ? 'opacity-30' : ''}`}>
                            {Number(date.slice(8))}
                          </Text>
                        </PressableFeedback>
                      );
                    })}
                  </View>
                ))}
              </View>
            </CalendarScroll>
          ) : null}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
